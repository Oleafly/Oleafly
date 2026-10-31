use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use oleafly_core::context::{scan_project, ContextLimits};
use oleafly_core::LogSeverity;
use oleafly_research::host::{CompileSummary, WorkspaceTools};
use oleafly_research::scheduler::TaskRuntimeFuture;
use serde_json::{json, Value};

use super::{lock, schema, LastBuild, ToolContext, ToolSpec};
use crate::agent::policy::Allow;
use crate::contract::{CliError, ErrorKind};
use crate::engine::{
    build_opened, open_project, BuildRequest, BuildResult, OpenedProject, ProjectOrigin,
};

const BUILD_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_ERRORS: usize = 50;
const LOG_TAIL_BYTES: usize = 16 * 1024;
pub(crate) const LOG_READ_BYTES: u64 = 256 * 1024;

pub(super) fn specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "compile",
            needs: Allow::Write,
            writes: true,
            schema: schema(
                "compile",
                "Build the project's PDF with Oleafly's compilers and report the errors.",
                json!({}),
                &[],
            ),
        },
        ToolSpec {
            name: "get_build_log",
            needs: Allow::Read,
            writes: false,
            schema: schema(
                "get_build_log",
                "Read the end of the latest build log.",
                json!({"tail_lines": {"type": "integer", "minimum": 1, "maximum": 2000, "description": "How many lines from the end (default 200)."}}),
                &[],
            ),
        },
    ]
}

pub(crate) fn tail_bytes(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

fn opened_for_build(project: &Path, work_root: &Path) -> Result<OpenedProject, CliError> {
    if project != work_root {
        if let Ok(original) = open_project(project, None, None) {
            if matches!(original.origin, ProjectOrigin::Linked { .. })
                && !work_root.join("project.json").is_file()
            {
                let workspace = oleafly_core::Workspace::from_manifest_with_build(
                    work_root,
                    original.workspace.manifest().clone(),
                    oleafly_core::BuildLocation::InTree,
                )?;
                return Ok(OpenedProject {
                    workspace,
                    origin: ProjectOrigin::Manifest,
                    warnings: Vec::new(),
                });
            }
        }
    }
    open_project(work_root, None, None)
}

pub(super) async fn compile(ctx: &Arc<ToolContext>) -> Result<Value, String> {
    let root = ctx.workspace.work_root().to_path_buf();
    let request = BuildRequest {
        timeout: BUILD_TIMEOUT,
        ..BuildRequest::default()
    };
    let opened = {
        let project = ctx.workspace.project().to_path_buf();
        let work_root = root.clone();
        tokio::task::spawn_blocking(move || opened_for_build(&project, &work_root))
            .await
            .map_err(|_| "The project could not be opened.".to_string())?
            .map_err(|error| error.message)?
    };
    let result = tokio::select! {
        result = build_opened(&opened, &request) => result.map_err(|error| error.message)?,
        _ = ctx.cancel.cancelled() => return Err("The run was stopped.".into()),
    };
    *lock(&ctx.last_build) = Some(LastBuild {
        ok: result.ok,
        log: result.log.clone(),
    });
    let errors: Vec<Value> = result
        .errors
        .iter()
        .take(MAX_ERRORS)
        .map(|error| serde_json::to_value(error).unwrap_or(Value::Null))
        .collect();
    let output = result
        .output
        .as_ref()
        .and_then(|output| output.strip_prefix(&root).ok())
        .map(|output| output.to_string_lossy().replace('\\', "/"));
    Ok(json!({
        "ok": result.ok,
        "engine": result.engine,
        "output": output,
        "errors": errors,
        "errorCount": result.errors.len(),
        "logTail": tail_bytes(&result.log, LOG_TAIL_BYTES),
    }))
}

fn last_lines(text: &str, lines: usize) -> (String, bool) {
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    (all[start..].join("\n"), start > 0)
}

pub(crate) fn latest_log_tail(root: &Path, lines: usize) -> Result<Value, String> {
    let opened = open_project(root, None, None).map_err(|error| error.message)?;
    let workspace = &opened.workspace;
    let latest =
        crate::record::latest_log(&workspace.build_dir_path(), &workspace.manifest().main_doc)
            .ok_or_else(|| "This project hasn't been built yet.".to_string())?;
    let (log, truncated) = crate::record::read_tail(&latest.path, lines, LOG_READ_BYTES)
        .map_err(|error| error.to_string())?;
    Ok(json!({"log": log, "truncated": truncated, "source": latest.source}))
}

pub(super) async fn build_log(ctx: Arc<ToolContext>, arguments: Value) -> Result<Value, String> {
    let lines = arguments["tail_lines"]
        .as_u64()
        .map_or(200, |lines| lines.clamp(1, 2000) as usize);
    if let Some(build) = lock(&ctx.last_build).clone() {
        let (log, truncated) = last_lines(tail_bytes(&build.log, LOG_READ_BYTES as usize), lines);
        return Ok(json!({"log": log, "truncated": truncated, "source": "run", "ok": build.ok}));
    }
    let root = ctx.workspace.work_root().to_path_buf();
    tokio::task::spawn_blocking(move || latest_log_tail(&root, lines))
        .await
        .map_err(|_| "The tool stopped before it returned a result.".to_string())?
}

pub struct CliWorkspaceTools;

pub(crate) fn opened_for_task_copy(
    root: &Path,
    source: Option<&Path>,
) -> Result<OpenedProject, CliError> {
    opened_for_build(source.unwrap_or(root), root)
}

pub(crate) async fn compile_summary(
    root: PathBuf,
    source: Option<PathBuf>,
) -> Result<CompileSummary, String> {
    let request = BuildRequest {
        timeout: BUILD_TIMEOUT,
        ..BuildRequest::default()
    };
    let opened =
        tokio::task::spawn_blocking(move || opened_for_task_copy(&root, source.as_deref()))
            .await
            .map_err(|_| "The project could not be opened.".to_string())?;
    summary_of(match opened {
        Ok(opened) => build_opened(&opened, &request).await,
        Err(error) => Err(error),
    })
}

fn summary_of(built: Result<BuildResult, CliError>) -> Result<CompileSummary, String> {
    match built {
        Ok(result) => Ok(CompileSummary {
            ok: result.ok,
            errors: u32::try_from(result.errors.len()).unwrap_or(u32::MAX),
            warnings: u32::try_from(
                result
                    .diagnostics
                    .iter()
                    .filter(|diagnostic| diagnostic.severity == LogSeverity::Warning)
                    .count(),
            )
            .unwrap_or(u32::MAX),
            log_tail: tail_bytes(&result.log, LOG_TAIL_BYTES).to_string(),
            skipped: None,
        }),
        Err(error) if error.kind == ErrorKind::MissingTool => Ok(CompileSummary {
            ok: false,
            skipped: Some(error.message),
            ..CompileSummary::default()
        }),
        Err(error) => Err(error.message),
    }
}

pub(crate) fn project_map_of(root: &Path) -> Result<Value, String> {
    let opened = open_project(root, None, None).map_err(|error| error.message)?;
    let main = opened.workspace.manifest().main_doc.clone();
    let scan = scan_project(root, &main, &ContextLimits::default())
        .map_err(|error| error.message().to_string())?;
    Ok(oleafly_core::context::map_view(&scan.map))
}

impl WorkspaceTools for CliWorkspaceTools {
    fn compile(&self, root: PathBuf, source: Option<PathBuf>) -> TaskRuntimeFuture<CompileSummary> {
        Box::pin(compile_summary(root, source))
    }

    fn project_map(&self, root: PathBuf) -> TaskRuntimeFuture<Value> {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || project_map_of(&root))
                .await
                .map_err(|_| "The project map could not be read.".to_string())?
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_with_main() -> tempfile::TempDir {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{sec:intro}\nHi\n\\end{document}\n",
        )
        .unwrap();
        project
    }

    #[test]
    fn the_build_log_tail_reads_only_the_end_of_a_huge_log() {
        let project = project_with_main();
        let build = project.path().join(".oleafly").join("build");
        std::fs::create_dir_all(&build).unwrap();
        let log = build.join(format!("{}.log", oleafly_core::engine_spec::ENTRY_STEM));
        let line = "x".repeat(99) + "\n";
        let mut text = line.repeat(10 * 1024 * 1024 / 100);
        text.push_str("the last line\n");
        std::fs::write(&log, text).unwrap();
        let value = latest_log_tail(project.path(), 5).unwrap();
        let tail = value["log"].as_str().unwrap();
        assert!(tail.len() <= LOG_READ_BYTES as usize);
        assert!(tail.trim_end().ends_with("the last line"));
        assert_eq!(value["truncated"], true);
    }

    #[test]
    fn a_copy_without_a_manifest_builds_as_a_folder_with_one_does() {
        let project = project_with_main();
        std::fs::write(
            project.path().join("project.json"),
            r#"{"name":"P","main_doc":"main.tex","engine":"latexmk","tex_flavor":"lualatex"}"#,
        )
        .unwrap();
        let copy = tempfile::tempdir().unwrap();
        std::fs::write(copy.path().join("main.tex"), "\\documentclass{article}").unwrap();
        let opened = opened_for_build(project.path(), copy.path()).unwrap();
        assert_eq!(opened.origin, ProjectOrigin::Detected);
        let opened = opened_for_build(project.path(), project.path()).unwrap();
        assert_eq!(
            opened.workspace.manifest().tex_flavor.as_deref(),
            Some("lualatex")
        );
    }

    #[test]
    fn an_unbuilt_project_says_so() {
        let project = project_with_main();
        assert!(latest_log_tail(project.path(), 10)
            .unwrap_err()
            .contains("hasn't been built"));
    }

    #[test]
    fn the_project_map_lists_sections_and_labels() {
        let project = project_with_main();
        let map = project_map_of(project.path()).unwrap();
        assert!(map["labels"].to_string().contains("sec:intro"), "{map}");
    }

    #[test]
    fn log_tails_are_cut_at_characters() {
        let text = "é".repeat(10);
        let tail = tail_bytes(&text, 5);
        assert!(tail.len() <= 5 && tail.chars().all(|character| character == 'é'));
        assert_eq!(last_lines("a\nb\nc", 2), ("b\nc".to_string(), true));
    }

    #[test]
    fn workspace_tools_report_a_missing_compiler_as_skipped() {
        let missing = CliError::new(
            ErrorKind::MissingTool,
            "build.missing_tool",
            "No LaTeX compiler was found.",
        );
        let summary = summary_of(Err(missing)).unwrap();
        assert!(!summary.ok);
        assert_eq!(
            summary.skipped.as_deref(),
            Some("No LaTeX compiler was found.")
        );
        let other = CliError::new(ErrorKind::Build, "build.failed", "It broke.");
        assert_eq!(summary_of(Err(other)).unwrap_err(), "It broke.");
    }
}
