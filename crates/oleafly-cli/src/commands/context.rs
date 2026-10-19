//! `oleafly context` (a map of the project for an agent or a person) and
//! `oleafly log` (the last build's log and diagnostics).
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::{Args, ValueEnum};
use oleafly_core::context::{scan_project, ContextLimits, ContextScan};
use oleafly_core::process_probe::probe_output;
use oleafly_core::tex_errors::{rebase_log_files, resolve_extensionless_inputs};
use oleafly_core::{parse_latex_log, LogDiagnostic, LogSeverity, Workspace, MAX_COMPILE_LOG_BYTES};
use serde_json::{json, Value};

use super::CommandModule;
use crate::contract::{CliError, Context, ErrorKind, Outcome};
use crate::engine::{open_project, OpenedProject};
use crate::record::{latest_log, read_record, read_tail, tail_chars, BuildRecord, LogSource};

const HUMAN_LOG_LINES: usize = 400;
const JSON_LOG_CHARS: usize = 20_000;
const MAX_TAIL_BYTES: u64 = 16 * 1024 * 1024;
const GIT_TIMEOUT: Duration = Duration::from_secs(3);
const MARKDOWN_SECTIONS: usize = 60;
const MARKDOWN_ITEMS: usize = 15;

#[derive(Debug, clap::Subcommand)]
pub enum Commands {
    /// Map the project for an AI agent: outline, labels, citations, problems
    Context(ContextArgs),
    /// Show the last build's log and its diagnostics
    Log(LogArgs),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ContextFormat {
    Md,
    Json,
}

#[derive(Debug, Args)]
pub struct ContextArgs {
    #[arg(
        long,
        value_enum,
        value_name = "FORMAT",
        help = "md (the default for people) or json (the default with --json)"
    )]
    pub format: Option<ContextFormat>,
}

#[derive(Debug, Args)]
pub struct LogArgs {
    #[arg(long, help = "List the errors and warnings with their file and line")]
    pub diagnostics: bool,
    #[arg(long, value_name = "LINES", value_parser = clap::value_parser!(u64).range(1..100_000), help = "Show only the last LINES lines")]
    pub tail: Option<u64>,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        match self {
            Self::Context(_) => "context",
            Self::Log(_) => "log",
        }
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        match self {
            Self::Context(args) => run_context(ctx, args).await,
            Self::Log(args) => run_log(ctx, args),
        }
    }
}

fn no_build() -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "project.no_build",
        "This project hasn't been built yet.",
    )
    .hint("Run `oleafly build` first.")
}

fn severity_label(severity: LogSeverity) -> &'static str {
    match severity {
        LogSeverity::Error => "error",
        LogSeverity::Warning => "warning",
        LogSeverity::Info => "info",
        LogSeverity::Typesetting => "typesetting",
    }
}

fn diagnostics_from_engine_log(workspace: &Workspace, path: &Path) -> Vec<LogDiagnostic> {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let mut bytes = Vec::new();
    if file
        .take(MAX_COMPILE_LOG_BYTES as u64)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&oleafly_core::rejoin_split_utf8_lines(&bytes)).into_owned();
    let main = workspace.manifest().main_doc.clone();
    let mut diagnostics = parse_latex_log(&text, Some(&main));
    rebase_log_files(
        workspace.root(),
        &workspace.compile_directory(),
        Some(&main),
        &mut [],
        &mut diagnostics,
    );
    resolve_extensionless_inputs(workspace.root(), &mut [], &mut diagnostics);
    diagnostics
}

fn run_log(ctx: &Context, args: LogArgs) -> Result<Outcome, CliError> {
    let opened = open_project(ctx.project(), None, None)?;
    let workspace = &opened.workspace;
    let build_dir = workspace.build_dir_path();
    let latest = latest_log(&build_dir, &workspace.manifest().main_doc).ok_or_else(no_build)?;
    let lines = args.tail.map_or(HUMAN_LOG_LINES, |lines| lines as usize);
    let (text, truncated) =
        read_tail(&latest.path, lines.max(1), MAX_TAIL_BYTES).map_err(CliError::from)?;
    let diagnostics: Vec<LogDiagnostic> = match (&latest.source, &latest.record) {
        (LogSource::Cli, Some(record)) => record.diagnostics.clone(),
        _ => diagnostics_from_engine_log(workspace, &latest.path),
    };
    let record: Option<&BuildRecord> = latest.record.as_ref();
    if !ctx.json() {
        if args.diagnostics {
            if diagnostics.is_empty() {
                ctx.say("No diagnostics.");
            }
            for diagnostic in &diagnostics {
                let location = match (&diagnostic.file, diagnostic.line) {
                    (Some(file), Some(line)) => format!("{file}:{line}: "),
                    (Some(file), None) => format!("{file}: "),
                    _ => String::new(),
                };
                ctx.say(format!(
                    "{location}{}: {}",
                    severity_label(diagnostic.severity),
                    diagnostic.message
                ));
            }
        } else {
            ctx.say(text.trim_end_matches('\n'));
            if !ctx.quiet() {
                ctx.note(format!("From {}", latest.path.display()));
            }
        }
    }
    let json_text = if args.tail.is_some() {
        (text.clone(), truncated)
    } else {
        let (tail, cut) = tail_chars(&text, JSON_LOG_CHARS);
        (tail, cut || truncated)
    };
    let mut log = json!({
        "source": latest.source,
        "path": latest.path,
        "text": json_text.0,
        "truncated": json_text.1,
    });
    if let Some(record) = record {
        log["ok"] = json!(record.ok);
        log["engine"] = json!(record.engine);
        log["finished_at_ms"] = json!(record.finished_at_ms);
    }
    let mut fields = json!({"log": log});
    if args.diagnostics {
        fields["diagnostics"] = json!(diagnostics);
        if let Some(record) = record {
            fields["errors"] = json!(record.errors);
        }
    }
    Ok(Outcome::success(fields))
}

/// `{branch, dirty, ahead, behind}` from `git status`, or `None`.
fn git_summary(root: &Path) -> Option<Value> {
    let root_text = root.to_str()?;
    let output = probe_output(
        Path::new("git"),
        &["-C", root_text, "status", "--porcelain=v2", "--branch"],
        GIT_TIMEOUT,
        1024 * 1024,
    )?;
    if !output.success {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut branch: Option<String> = None;
    let mut ahead = 0i64;
    let mut behind = 0i64;
    let mut dirty = false;
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            branch = (head != "(detached)").then(|| head.to_string());
        } else if let Some(counts) = line.strip_prefix("# branch.ab ") {
            for part in counts.split_whitespace() {
                if let Some(value) = part.strip_prefix('+') {
                    ahead = value.parse().unwrap_or(0);
                } else if let Some(value) = part.strip_prefix('-') {
                    behind = value.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            dirty = true;
        }
    }
    Some(json!({"branch": branch, "dirty": dirty, "ahead": ahead, "behind": behind}))
}

/// `{count, latest_at_ms, latest_label}` for the app's checkpoints, or `None`.
fn checkpoint_summary(root: &Path, data_root: Option<&Path>) -> Option<Value> {
    let data_root = data_root?;
    let identity = crate::app_paths::project_identity(root, data_root)?;
    let store_dir =
        crate::app_paths::existing_checkpoint_store(data_root, identity.id()).ok()??;
    let store = oleafly_history::Store::open_existing(&store_dir).ok()??;
    let mut checkpoints = store.list().ok()?;
    checkpoints.sort_by_key(|checkpoint| checkpoint.completed_at_unix_ms);
    let latest = checkpoints.last();
    Some(json!({
        "count": checkpoints.len(),
        "latest_at_ms": latest.map(|checkpoint| checkpoint.completed_at_unix_ms),
        "latest_label": latest.and_then(|checkpoint| checkpoint.label.clone()),
    }))
}

fn last_build_summary(build_dir: &Path) -> Value {
    match read_record(build_dir) {
        Some(record) => json!({
            "ok": record.ok,
            "engine": record.engine,
            "finished_at_ms": record.finished_at_ms,
            "errors": record.errors.iter().take(20).collect::<Vec<_>>(),
        }),
        None => Value::Null,
    }
}

fn project_value(opened: &OpenedProject, data_root: Option<&Path>) -> Value {
    let workspace = &opened.workspace;
    let manifest = workspace.manifest();
    let project_id = data_root
        .and_then(|data_root| crate::app_paths::project_identity(workspace.root(), data_root))
        .map(|identity| identity.id().to_string());
    json!({
        "root": workspace.root(),
        "name": manifest.name,
        "main_document": manifest.main_doc,
        "engine": manifest.engine().ok().map(|engine| engine.canonical_name()),
        "compiler": manifest.tex_flavor,
        "build_directory": workspace.build_dir_path(),
        "origin": opened.origin.label(),
        "project_id": project_id,
    })
}

/// The whole `oleafly context` result (also the MCP `context` tool's).
pub(crate) async fn context_value(
    root: &Path,
    data_root: Option<PathBuf>,
) -> Result<(Value, ContextScan), CliError> {
    let opened = open_project(root, None, None)?;
    let scan_root = opened.workspace.root().to_path_buf();
    let main = opened.workspace.manifest().main_doc.clone();
    let scan = tokio::task::spawn_blocking(move || {
        scan_project(&scan_root, &main, &ContextLimits::default())
    })
    .await
    .map_err(|error| CliError::internal(format!("The project scan stopped: {error}")))??;
    let git_root = opened.workspace.root().to_path_buf();
    let git = tokio::task::spawn_blocking(move || git_summary(&git_root))
        .await
        .ok()
        .flatten();
    let checkpoints = checkpoint_summary(opened.workspace.root(), data_root.as_deref());
    let value = json!({
        "project": project_value(&opened, data_root.as_deref()),
        "map": scan.map,
        "roles": scan.roles,
        "unused_cites": scan.unused_cites,
        "unused_labels": scan.unused_labels,
        "missing_files": scan.missing_files,
        "packages": scan.packages,
        "last_build": last_build_summary(&opened.workspace.build_dir_path()),
        "git": git,
        "checkpoints": checkpoints,
        "truncated": scan.truncated,
        "skipped": scan.skipped,
    });
    Ok((value, scan))
}

fn bounded_list(items: &[String]) -> String {
    let shown: Vec<&str> = items
        .iter()
        .take(MARKDOWN_ITEMS)
        .map(String::as_str)
        .collect();
    let rest = items.len().saturating_sub(MARKDOWN_ITEMS);
    if rest > 0 {
        format!("{} and {rest} more", shown.join(", "))
    } else {
        shown.join(", ")
    }
}

/// The context as Markdown for a person or a prompt (at most 200 lines).
fn context_markdown(value: &Value, scan: &ContextScan) -> String {
    let project = &value["project"];
    let mut lines: Vec<String> = Vec::new();
    let name = project["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or("Project");
    lines.push(format!("# {name}"));
    lines.push(String::new());
    let mut summary = format!(
        "Engine: {} · Main document: {} · Build folder: {}",
        project["engine"].as_str().unwrap_or("unknown"),
        project["main_document"].as_str().unwrap_or("?"),
        project["build_directory"].as_str().unwrap_or("?")
    );
    if let Some(compiler) = project["compiler"].as_str() {
        summary.push_str(&format!(" · Compiler: {compiler}"));
    }
    lines.push(summary);
    lines.push(format!(
        "{} source files · {} labels · {} citation keys · {} macros",
        scan.map.files.len(),
        scan.map.labels.len(),
        scan.map.bib_keys.len(),
        scan.map.macros.len()
    ));
    if !scan.map.sections.is_empty() {
        lines.push(String::new());
        lines.push("## Outline".into());
        let base = scan
            .map
            .sections
            .iter()
            .map(|section| section.level)
            .min()
            .unwrap_or(0);
        for section in scan.map.sections.iter().take(MARKDOWN_SECTIONS) {
            let indent = "  ".repeat((section.level - base) as usize);
            lines.push(format!(
                "{indent}- {} ({}:{})",
                section.title, section.file, section.line
            ));
        }
        if scan.map.sections.len() > MARKDOWN_SECTIONS {
            lines.push(format!(
                "- and {} more sections",
                scan.map.sections.len() - MARKDOWN_SECTIONS
            ));
        }
    }
    let mut problems: Vec<String> = Vec::new();
    if !scan.map.unresolved_refs.is_empty() {
        problems.push(format!(
            "- Unresolved references: {}",
            bounded_list(&scan.map.unresolved_refs)
        ));
    }
    if !scan.map.unresolved_cites.is_empty() {
        problems.push(format!(
            "- Unresolved citations: {}",
            bounded_list(&scan.map.unresolved_cites)
        ));
    }
    for missing in scan.missing_files.iter().take(MARKDOWN_ITEMS) {
        problems.push(format!(
            "- Missing {} `{}` ({}:{})",
            missing.kind, missing.target, missing.file, missing.line
        ));
    }
    if !scan.unused_cites.is_empty() {
        problems.push(format!(
            "- Citation keys never cited: {}",
            bounded_list(&scan.unused_cites)
        ));
    }
    if !scan.unused_labels.is_empty() {
        problems.push(format!(
            "- Labels never referenced: {}",
            bounded_list(&scan.unused_labels)
        ));
    }
    if !problems.is_empty() {
        lines.push(String::new());
        lines.push("## Problems".into());
        lines.extend(problems);
    }
    if let Some(errors) = value["last_build"]["errors"].as_array() {
        lines.push(String::new());
        let ok = value["last_build"]["ok"].as_bool().unwrap_or(false);
        lines.push(format!(
            "## Last build: {}",
            if ok { "succeeded" } else { "failed" }
        ));
        for error in errors.iter().take(10) {
            let location = match (error["file"].as_str(), error["line"].as_u64()) {
                (Some(file), Some(line)) => format!("{file}:{line}: "),
                _ => String::new(),
            };
            lines.push(format!(
                "- {location}{}",
                error["message"].as_str().unwrap_or("")
            ));
        }
    }
    if let Some(git) = value["git"].as_object() {
        lines.push(String::new());
        let branch = git
            .get("branch")
            .and_then(Value::as_str)
            .unwrap_or("detached");
        let dirty = if git.get("dirty").and_then(Value::as_bool).unwrap_or(false) {
            "uncommitted changes"
        } else {
            "clean"
        };
        lines.push(format!(
            "Git: {branch} · {dirty} · {} ahead, {} behind",
            git["ahead"], git["behind"]
        ));
    }
    if let Some(checkpoints) = value["checkpoints"].as_object() {
        lines.push(format!(
            "Checkpoints: {}",
            checkpoints.get("count").cloned().unwrap_or(json!(0))
        ));
    }
    if scan.truncated {
        lines.push(format!(
            "Only the first {} source files were read.",
            scan.map.files.len()
        ));
    }
    lines.push(String::new());
    lines.push("Run `oleafly context --json` for everything.".into());
    lines.truncate(200);
    lines.join("\n")
}

async fn run_context(ctx: &Context, args: ContextArgs) -> Result<Outcome, CliError> {
    let (value, scan) =
        context_value(ctx.project(), ctx.data_root().map(Path::to_path_buf)).await?;
    let format = args.format.unwrap_or(if ctx.json() {
        ContextFormat::Json
    } else {
        ContextFormat::Md
    });
    if !ctx.json() {
        match format {
            ContextFormat::Md => ctx.say(context_markdown(&value, &scan)),
            ContextFormat::Json => {
                ctx.say(serde_json::to_string_pretty(&value).unwrap_or_default())
            }
        }
    }
    Ok(Outcome::success(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_status_lines_become_a_summary() {
        let dir = tempfile::tempdir().unwrap();
        assert!(git_summary(dir.path())
            .is_none_or(|value| value["branch"].is_string() || value["branch"].is_null()));
    }

    #[test]
    fn markdown_context_stays_short() {
        let mut scan = ContextScan::default();
        for index in 0..500 {
            scan.map.sections.push(oleafly_core::context::SectionEntry {
                title: format!("Section {index}"),
                level: 2,
                file: "main.tex".into(),
                line: index,
            });
            scan.map.unresolved_refs.push(format!("ref{index}"));
        }
        let value = json!({"project": {"name": "Big"}, "last_build": null, "git": null, "checkpoints": null});
        let markdown = context_markdown(&value, &scan);
        assert!(markdown.lines().count() <= 200);
        assert!(markdown.contains("and 440 more sections"));
        assert!(markdown.contains("ref0"));
    }
}
