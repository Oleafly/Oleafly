use std::path::{Path, PathBuf};

use oleafly_core::typst_log::{self, TypstSeverity};
use oleafly_core::typst_toolchain::{
    typst_compile_args, TypstCapabilities, TypstCompileFlag, TypstDiagnosticFormat,
};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::typst_options::TypstCompileSettings;

const DEFAULT_PPI: u32 = 144;
const MAX_PPI: u32 = 1200;
const STAGED_STEM: &str = "page";
const HTML_READER: &str = "--from=html-native_divs-native_spans";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TypstExportFormat {
    Pdf,
    Png,
    Svg,
    Html,
}

impl TypstExportFormat {
    const fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Png => "png",
            Self::Svg => "svg",
            Self::Html => "html",
        }
    }

    const fn paged_images(self) -> bool {
        matches!(self, Self::Png | Self::Svg)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstExportRequest {
    pub format: TypstExportFormat,
    #[serde(default)]
    pub ppi: Option<u32>,
    #[serde(default)]
    pub pages: Option<String>,
    #[serde(default)]
    pub pdf_standard: Option<String>,
    #[serde(default)]
    pub variant: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstExportResult {
    pub files: Vec<String>,
}

pub(crate) struct TypstRun<'a> {
    pub typst: &'a Path,
    pub capabilities: &'a TypstCapabilities,
    pub root: &'a Path,
    pub main_doc: &'a str,
    pub settings: &'a TypstCompileSettings,
    pub environment: Vec<(String, String)>,
}

fn export_error(code: &'static str, detail: impl ToString) -> String {
    AppError::new(code).detail(detail).into()
}

pub(crate) fn export_flags(request: &TypstExportRequest) -> Result<Vec<TypstCompileFlag>, String> {
    let mut flags = Vec::new();
    match request.format {
        TypstExportFormat::Pdf => {
            if let Some(standard) = request
                .pdf_standard
                .as_deref()
                .map(str::trim)
                .filter(|standard| !standard.is_empty())
            {
                flags.push(TypstCompileFlag::PdfStandard(standard.to_owned()));
            }
        }
        TypstExportFormat::Png => {
            let ppi = request.ppi.unwrap_or(DEFAULT_PPI);
            if ppi == 0 || ppi > MAX_PPI {
                return Err(AppError::new("typst_export.invalid_ppi")
                    .param("max", MAX_PPI)
                    .into());
            }
            flags.push(TypstCompileFlag::Format("png".into()));
            flags.push(TypstCompileFlag::Ppi(ppi));
        }
        TypstExportFormat::Svg => flags.push(TypstCompileFlag::Format("svg".into())),
        TypstExportFormat::Html => {
            flags.push(TypstCompileFlag::Features("html".into()));
            flags.push(TypstCompileFlag::Format("html".into()));
        }
    }
    if request.format != TypstExportFormat::Html {
        if let Some(pages) = request
            .pages
            .as_deref()
            .filter(|pages| !pages.trim().is_empty())
        {
            flags.push(TypstCompileFlag::Pages(pages.to_owned()));
        }
    }
    Ok(flags)
}

pub(crate) fn failure_detail(log: &str) -> String {
    let diagnostics = typst_log::parse_typst_diagnostics(log);
    let Some(error) = diagnostics
        .iter()
        .find(|diagnostic| diagnostic.severity == TypstSeverity::Error)
    else {
        return log
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("Typst stopped without a message.")
            .to_owned();
    };
    let mut detail = match error.user_span() {
        Some(span) => format!(
            "{}:{}:{}: {}",
            span.file,
            span.line,
            span.column + 1,
            error.message
        ),
        None => error.message.clone(),
    };
    for hint in &error.hints {
        detail.push_str("\nHint: ");
        detail.push_str(hint);
    }
    detail
}

pub(crate) async fn run_typst(
    run: &TypstRun<'_>,
    output: &Path,
    extra: &[TypstCompileFlag],
) -> Result<(), String> {
    let mut flags = run.settings.compile_flags(run.capabilities);
    flags.extend_from_slice(extra);
    let args: Vec<String> = typst_compile_args(
        run.capabilities,
        &run.root.join(run.main_doc),
        output,
        run.root,
        TypstDiagnosticFormat::Human,
        &flags,
    )
    .map_err(|error| export_error("typst_export.unsupported", error))?
    .into_iter()
    .map(|argument| argument.to_string_lossy().into_owned())
    .collect();
    let mut variables = run.environment.clone();
    if let Some(epoch) = run.settings.source_date_epoch(None) {
        variables.push(("SOURCE_DATE_EPOCH".into(), epoch.to_string()));
    }
    let (log, code) = crate::document_engine::run_supervised_external_with_variables(
        run.typst, &args, run.root, &variables,
    )
    .await?;
    if code != Some(0) {
        return Err(export_error("typst_export.failed", failure_detail(&log)));
    }
    Ok(())
}

fn staged_pages(staging: &Path, extension: &str) -> Vec<PathBuf> {
    let mut pages: Vec<(u32, PathBuf)> = std::fs::read_dir(staging)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let number = name
                .strip_prefix(&format!("{STAGED_STEM}-"))?
                .strip_suffix(&format!(".{extension}"))?
                .parse::<u32>()
                .ok()?;
            Some((number, entry.path()))
        })
        .collect();
    pages.sort();
    pages.into_iter().map(|(_, path)| path).collect()
}

pub(crate) async fn render_export(
    run: &TypstRun<'_>,
    request: &TypstExportRequest,
    staging: &Path,
) -> Result<Vec<PathBuf>, String> {
    let flags = export_flags(request)?;
    let extension = request.format.extension();
    let output = if request.format.paged_images() {
        staging.join(format!("{STAGED_STEM}-{{0p}}.{extension}"))
    } else {
        staging.join(format!("{STAGED_STEM}.{extension}"))
    };
    run_typst(run, &output, &flags).await?;
    let produced = if request.format.paged_images() {
        staged_pages(staging, extension)
    } else {
        vec![output]
            .into_iter()
            .filter(|path| path.is_file())
            .collect()
    };
    if produced.is_empty() {
        return Err(export_error(
            "typst_export.failed",
            "Typst finished without writing a file.",
        ));
    }
    Ok(produced)
}

pub(crate) fn final_destinations(dest: &Path, produced: &[PathBuf]) -> Vec<PathBuf> {
    if produced.len() <= 1 {
        return vec![dest.to_path_buf()];
    }
    let stem = dest
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".into());
    let extension = dest
        .extension()
        .map(|extension| extension.to_string_lossy().into_owned());
    let folder = dest.parent().map(Path::to_path_buf).unwrap_or_default();
    produced
        .iter()
        .map(|page| {
            let number = page
                .file_stem()
                .and_then(std::ffi::OsStr::to_str)
                .and_then(|stem| stem.strip_prefix(&format!("{STAGED_STEM}-")))
                .unwrap_or("0");
            let name = match &extension {
                Some(extension) => format!("{stem}-{number}.{extension}"),
                None => format!("{stem}-{number}"),
            };
            folder.join(name)
        })
        .collect()
}

fn publish(produced: &[PathBuf], destinations: &[PathBuf]) -> Result<(), String> {
    for (source, destination) in produced.iter().zip(destinations) {
        let destination = destination.to_string_lossy().into_owned();
        let transaction = crate::sandbox::AtomicFile::for_export(&destination)?;
        std::fs::copy(source, transaction.staging_path())
            .map_err(|error| format!("failed to stage the export: {error}"))?;
        transaction.commit()?;
    }
    Ok(())
}

pub(crate) async fn render_html(run: &TypstRun<'_>, staging: &Path) -> Result<PathBuf, String> {
    let output = staging.join("document.html");
    run_typst(
        run,
        &output,
        &[
            TypstCompileFlag::Features("html".into()),
            TypstCompileFlag::Format("html".into()),
        ],
    )
    .await?;
    Ok(output)
}

pub(crate) fn pandoc_html_args(
    format: &str,
    html: &Path,
    root: &Path,
    output: &str,
) -> Option<Vec<String>> {
    let source = crate::conversion::ExportSource {
        file_name: html.to_string_lossy().into_owned(),
        resource_path: crate::project_availability::without_verbatim_prefix(root)
            .to_string_lossy()
            .into_owned(),
    };
    let mut args = crate::conversion::export_args(format, &source, output, None)?;
    args.insert(0, HTML_READER.to_owned());
    Some(args)
}

pub(crate) async fn pandoc_from_html(
    pandoc: &Path,
    html: &Path,
    root: &Path,
    format: &str,
    output: &str,
) -> Result<(), String> {
    let args = pandoc_html_args(format, html, root, output)
        .ok_or_else(|| format!("unsupported export format: {format}"))?;
    let working = html.parent().unwrap_or(root);
    let (log, code) =
        crate::document_engine::run_supervised_external_with_variables(pandoc, &args, working, &[])
            .await?;
    if code != Some(0) {
        return Err(crate::pandoc_citations::export_failure(&log, root));
    }
    Ok(())
}

fn html_route_supported(capabilities: &TypstCapabilities) -> bool {
    capabilities.supports_output_format("html") && capabilities.supports_flag("--features")
}

struct ResolvedProject {
    meta: crate::project::ProjectMeta,
    typst: std::sync::Arc<oleafly_core::typst_toolchain::ResolvedTypst>,
    settings: TypstCompileSettings,
    environment: Vec<(String, String)>,
}

fn resolve_project(
    project_id: &str,
    main_doc: &str,
    root: &Path,
    variant: Option<&str>,
) -> Result<Option<ResolvedProject>, String> {
    let meta = crate::project::read_compile_meta(project_id, main_doc)?;
    let Some(typst) = crate::typst_toolchain::resolve_for_compile(&meta)? else {
        return Ok(None);
    };
    let settings = crate::typst_options::for_compile(&meta, root, variant).unwrap_or_default();
    let environment = crate::typst_packages::for_compile(&meta, root)?
        .map(|packages| {
            packages
                .environment()
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value.to_string_lossy().into_owned()))
                .collect()
        })
        .unwrap_or_default();
    Ok(Some(ResolvedProject {
        meta,
        typst,
        settings,
        environment,
    }))
}

async fn resolve_project_async(
    project_id: &str,
    main_doc: &str,
    root: &Path,
    variant: Option<String>,
) -> Result<Option<ResolvedProject>, String> {
    let project_id = project_id.to_owned();
    let main_doc = main_doc.to_owned();
    let root = root.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        resolve_project(&project_id, &main_doc, &root, variant.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) async fn convert_through_html(
    project_id: &str,
    root: &Path,
    main_doc: &str,
    format: &str,
    pandoc: &Path,
    output: &str,
    variant: Option<String>,
) -> Result<bool, String> {
    if format == "typst" {
        return Ok(false);
    }
    let Some(project) = resolve_project_async(project_id, main_doc, root, variant).await? else {
        return Ok(false);
    };
    if !crate::typst_toolchain::is_typst_project(&project.meta)
        || !html_route_supported(&project.typst.capabilities)
    {
        return Ok(false);
    }
    let staging = tempfile::Builder::new()
        .prefix("oleafly-typst-html-")
        .tempdir()
        .map_err(|error| format!("failed to create an export folder: {error}"))?;
    let run = TypstRun {
        typst: &project.typst.path,
        capabilities: &project.typst.capabilities,
        root,
        main_doc,
        settings: &project.settings,
        environment: project.environment.clone(),
    };
    let html = render_html(&run, staging.path()).await?;
    pandoc_from_html(pandoc, &html, root, format, output).await?;
    Ok(true)
}

#[tauri::command]
pub async fn export_typst_document(
    project_id: String,
    main_doc: String,
    request: TypstExportRequest,
    dest: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<TypstExportResult, String> {
    crate::sandbox::guard_export_dest(&dest)?;
    if !Path::new(&dest)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case(request.format.extension()))
    {
        return Err(format!(
            "export destination must end in .{}",
            request.format.extension()
        ));
    }
    let worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
    let root = crate::project_location::locate(&project_id)?.root;
    crate::project::require_export_destination_outside_project(&root, &dest)?;
    let project = resolve_project_async(&project_id, &main_doc, &root, request.variant.clone())
        .await?
        .ok_or_else(|| String::from(AppError::new("typst_toolchain.not_typst_project")))?;
    let staging = tempfile::Builder::new()
        .prefix("oleafly-typst-export-")
        .tempdir()
        .map_err(|error| format!("failed to create an export folder: {error}"))?;
    let run = TypstRun {
        typst: &project.typst.path,
        capabilities: &project.typst.capabilities,
        root: &root,
        main_doc: &main_doc,
        settings: &project.settings,
        environment: project.environment.clone(),
    };
    let produced = render_export(&run, &request, staging.path()).await?;
    drop(worktree);
    let destinations = final_destinations(Path::new(&dest), &produced);
    {
        let produced = produced.clone();
        let destinations = destinations.clone();
        tauri::async_runtime::spawn_blocking(move || publish(&produced, &destinations))
            .await
            .map_err(|error| error.to_string())??;
    }
    {
        let mut allow = state.reveal_allowlist.lock().await;
        for destination in &destinations {
            if let Ok(canonical) = destination.canonicalize() {
                if allow.len() >= 1024 {
                    allow.pop_front();
                }
                allow.push_back(canonical);
            }
        }
    }
    let files: Vec<String> = destinations
        .iter()
        .map(|destination| destination.to_string_lossy().into_owned())
        .collect();
    if let Some(first) = files.first().cloned() {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            crate::project::record_pdf_export(project_id, first)
        })
        .await;
    }
    Ok(TypstExportResult { files })
}

#[cfg(test)]
mod tests;
