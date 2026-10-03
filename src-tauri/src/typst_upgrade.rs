#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

use oleafly_core::typst_toolchain::{ResolvedTypst, ToolchainVersion};
use serde::Serialize;

use crate::document_engine::{
    CompileError, CompileOptions, DocumentEngineId, EngineCompileSpec, EngineExecutable,
};

type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

const PAGE_TREE_WINDOW: usize = 512;
const MAX_FAILURE_CHARS: usize = 2000;

#[derive(Clone, Debug, Default)]
pub(crate) struct UpgradeOutput {
    pub(crate) ok: bool,
    pub(crate) pages: Option<u32>,
    pub(crate) errors: Vec<CompileError>,
    pub(crate) compile_time_ms: u64,
    pub(crate) log: String,
}

pub(crate) trait UpgradeCompiler: Send + Sync {
    fn compile(&self, typst: Arc<ResolvedTypst>) -> BoxFuture<Result<UpgradeOutput, String>>;
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpgradeRun {
    pub(crate) version: String,
    pub(crate) ok: bool,
    pub(crate) pages: Option<u32>,
    pub(crate) errors: usize,
    pub(crate) warnings: usize,
    pub(crate) compile_time_ms: u64,
    pub(crate) failure: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpgradeFinding {
    pub(crate) kind: String,
    pub(crate) file: Option<String>,
    pub(crate) line: Option<u32>,
    pub(crate) column: Option<u32>,
    pub(crate) message: String,
    pub(crate) hints: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpgradeReport {
    pub(crate) current: UpgradeRun,
    pub(crate) candidate: UpgradeRun,
    pub(crate) added: Vec<UpgradeFinding>,
    pub(crate) removed: Vec<UpgradeFinding>,
    pub(crate) unchanged: usize,
}

pub(crate) struct FindingDiff {
    pub(crate) added: Vec<UpgradeFinding>,
    pub(crate) removed: Vec<UpgradeFinding>,
    pub(crate) unchanged: usize,
}

fn is_error(finding: &CompileError) -> bool {
    finding.kind == "error"
}

fn normalized_file(file: Option<&str>) -> Option<String> {
    file.map(|file| {
        let file = file.replace('\\', "/");
        file.strip_prefix("./").map(str::to_owned).unwrap_or(file)
    })
}

type FindingKey = (bool, Option<String>, Option<u32>, String);

fn finding_key(finding: &CompileError) -> FindingKey {
    (
        !is_error(finding),
        normalized_file(finding.file.as_deref()),
        finding.line,
        finding.message.trim().to_owned(),
    )
}

fn finding(error: &CompileError) -> UpgradeFinding {
    UpgradeFinding {
        kind: if is_error(error) { "error" } else { "warning" }.to_owned(),
        file: normalized_file(error.file.as_deref()),
        line: error.line,
        column: error.column,
        message: error.message.trim().to_owned(),
        hints: error.hints.clone(),
    }
}

fn unmatched(
    from: &[CompileError],
    against: &HashMap<FindingKey, usize>,
) -> (Vec<UpgradeFinding>, usize) {
    let mut remaining = against.clone();
    let mut extra: Vec<(FindingKey, UpgradeFinding)> = Vec::new();
    let mut matched = 0;
    for error in from {
        let key = finding_key(error);
        match remaining.get_mut(&key) {
            Some(count) if *count > 0 => {
                *count -= 1;
                matched += 1;
            }
            _ => extra.push((key, finding(error))),
        }
    }
    extra.sort_by(|left, right| left.0.cmp(&right.0));
    (
        extra.into_iter().map(|(_, finding)| finding).collect(),
        matched,
    )
}

fn counted(errors: &[CompileError]) -> HashMap<FindingKey, usize> {
    let mut counts = HashMap::new();
    for error in errors {
        *counts.entry(finding_key(error)).or_insert(0) += 1;
    }
    counts
}

pub(crate) fn diff_findings(current: &[CompileError], candidate: &[CompileError]) -> FindingDiff {
    let (added, unchanged) = unmatched(candidate, &counted(current));
    let (removed, _) = unmatched(current, &counted(candidate));
    FindingDiff {
        added,
        removed,
        unchanged,
    }
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|position| position + from)
}

fn skip_space(bytes: &[u8], mut index: usize) -> usize {
    while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
        index += 1;
    }
    index
}

fn count_near(bytes: &[u8], start: usize, end: usize) -> Option<u32> {
    let window = &bytes[start..end.min(bytes.len())];
    let mut from = 0;
    while let Some(position) = find(window, b"/Count", from) {
        let digits_start = skip_space(window, position + b"/Count".len());
        let digits_end = window[digits_start..]
            .iter()
            .position(|byte| !byte.is_ascii_digit())
            .map_or(window.len(), |offset| digits_start + offset);
        if digits_end > digits_start {
            return std::str::from_utf8(&window[digits_start..digits_end])
                .ok()?
                .parse()
                .ok();
        }
        from = position + 1;
    }
    None
}

pub(crate) fn pdf_page_count(bytes: &[u8]) -> Option<u32> {
    if !bytes.starts_with(b"%PDF-") {
        return None;
    }
    let mut best: Option<u32> = None;
    let mut from = 0;
    while let Some(position) = find(bytes, b"/Type", from) {
        from = position + 1;
        let name = skip_space(bytes, position + b"/Type".len());
        if !bytes[name..].starts_with(b"/Pages") {
            continue;
        }
        let after = name + b"/Pages".len();
        if bytes.get(after).is_some_and(u8::is_ascii_alphanumeric) {
            continue;
        }
        let dictionary = bytes[..position]
            .windows(2)
            .rposition(|window| window == b"<<")
            .filter(|start| position - start <= PAGE_TREE_WINDOW)
            .unwrap_or(position);
        let close = find(bytes, b">>", after).unwrap_or(bytes.len());
        if let Some(count) = count_near(bytes, dictionary, close.min(after + PAGE_TREE_WINDOW)) {
            best = Some(best.map_or(count, |current| current.max(count)));
        }
    }
    best
}

fn failure_text(output: &UpgradeOutput) -> Option<String> {
    if output.ok || output.errors.iter().any(is_error) {
        return None;
    }
    let log = output.log.trim();
    let start = log
        .char_indices()
        .map(|(index, _)| index)
        .find(|index| log.len() - index <= MAX_FAILURE_CHARS)
        .unwrap_or(log.len());
    Some(log[start..].to_owned()).filter(|text| !text.is_empty())
}

fn run_summary(version: &ToolchainVersion, output: &UpgradeOutput) -> UpgradeRun {
    UpgradeRun {
        version: version.to_string(),
        ok: output.ok,
        pages: output.pages,
        errors: output.errors.iter().filter(|error| is_error(error)).count(),
        warnings: output
            .errors
            .iter()
            .filter(|error| !is_error(error))
            .count(),
        compile_time_ms: output.compile_time_ms,
        failure: failure_text(output),
    }
}

pub(crate) async fn compare(
    compiler: &dyn UpgradeCompiler,
    current: Arc<ResolvedTypst>,
    candidate: Arc<ResolvedTypst>,
) -> Result<UpgradeReport, String> {
    if candidate.version <= current.version {
        return Err(format!(
            "Typst {} is not newer than Typst {}",
            candidate.version, current.version
        ));
    }
    let current_version = current.version.clone();
    let candidate_version = candidate.version.clone();
    let before = compiler.compile(current).await?;
    let after = compiler.compile(candidate).await?;
    let diff = diff_findings(&before.errors, &after.errors);
    Ok(UpgradeReport {
        current: run_summary(&current_version, &before),
        candidate: run_summary(&candidate_version, &after),
        added: diff.added,
        removed: diff.removed,
        unchanged: diff.unchanged,
    })
}

pub(crate) async fn run_spec(
    spec: EngineCompileSpec,
    main_document: &str,
    project_dir: &Path,
) -> Result<UpgradeOutput, String> {
    let program = match &spec.executable {
        EngineExecutable::BundledSidecar(name) => {
            crate::document_engine::resolve_bundled_sidecar(name)?
        }
        EngineExecutable::ExternalPath(path) => path.clone(),
    };
    let started = std::time::Instant::now();
    let (log, exit_code) = crate::document_engine::run_supervised_external_with_variables(
        &program,
        &spec.args,
        &spec.working_dir,
        spec.environment.variables(),
    )
    .await?;
    let compile_time_ms = started.elapsed().as_millis() as u64;
    let pdf = match spec.artifacts.pdf.clone() {
        Some(path) => tokio::task::spawn_blocking(move || std::fs::read(path).ok())
            .await
            .map_err(|error| format!("failed to read the test PDF: {error}"))?,
        None => None,
    };
    let (log, _, errors) = crate::document_engine::typst_log_errors(
        log,
        main_document,
        project_dir.to_owned(),
        spec.working_dir.clone(),
    )
    .await?;
    let ok = exit_code == Some(0) && pdf.is_some() && !errors.iter().any(is_error);
    Ok(UpgradeOutput {
        ok,
        pages: pdf.as_deref().and_then(pdf_page_count),
        errors,
        compile_time_ms,
        log,
    })
}

struct ProjectCompiler {
    main: Arc<crate::commands::MainCompile>,
    main_document: String,
}

impl UpgradeCompiler for ProjectCompiler {
    fn compile(&self, typst: Arc<ResolvedTypst>) -> BoxFuture<Result<UpgradeOutput, String>> {
        let main = self.main.clone();
        let main_document = self.main_document.clone();
        Box::pin(async move {
            let output = tempfile::Builder::new()
                .prefix("oleafly-typst-upgrade-")
                .tempdir()
                .map_err(|error| format!("failed to create a temporary output folder: {error}"))?;
            let options = CompileOptions {
                typst: Some(typst),
                ..main.options.clone()
            };
            let spec = main.spec(&main_document, output.path(), options).await?;
            let result = run_spec(spec, &main_document, &main.project_dir).await;
            drop(output);
            result
        })
    }
}

#[tauri::command]
pub async fn typst_upgrade_check(
    project_id: String,
    main_doc: String,
    version: String,
    offline: Option<bool>,
    typst_variant: Option<String>,
) -> Result<UpgradeReport, String> {
    let main = {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        let options = crate::commands::requested_compile_options(offline, None, None);
        crate::commands::MainCompile::prepare(&project_id, &main_doc, typst_variant, options)
            .await?
    };
    if main.engine.id() != DocumentEngineId::Typst {
        return Err("The upgrade check is only available for Typst projects.".into());
    }
    let current = main
        .options
        .typst
        .clone()
        .ok_or("this project has no resolved Typst version")?;
    let candidate = tauri::async_runtime::spawn_blocking(move || {
        crate::typst_toolchain::resolve_version(&version)
    })
    .await
    .map_err(|error| format!("failed to resolve the Typst version: {error}"))??;
    let compiler = ProjectCompiler {
        main: Arc::new(main),
        main_document: main_doc,
    };
    compare(&compiler, current, candidate).await
}
