//! The tools `oleafly mcp` serves without the app. Names and result shapes
//! follow the app's MCP tools, so a skill works against either.
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::time::Duration;

use serde_json::{json, Value};

use super::{ToolAnnotations, ToolMeta};
use crate::contract::{Context, ContextOptions};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Bounds for the file tools.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ToolLimits {
    pub max_list: usize,
    pub max_search_results: usize,
    pub max_read_lines: usize,
    pub max_read_chars: usize,
    pub max_file_bytes: u64,
    pub max_search_bytes: u64,
}

impl Default for ToolLimits {
    fn default() -> Self {
        Self {
            max_list: 5_000,
            max_search_results: 20,
            max_read_lines: 800,
            max_read_chars: 40_000,
            max_file_bytes: 16 * 1024 * 1024,
            max_search_bytes: 64 * 1024 * 1024,
        }
    }
}

/// What a tool call knows.
#[derive(Clone, Debug)]
pub struct ToolContext {
    pub root: PathBuf,
    pub data_root: Option<PathBuf>,
    pub build_timeout: Duration,
    pub limits: ToolLimits,
}

/// A tool failure, reported to the client as `isError` text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolError(pub String);

impl From<crate::contract::CliError> for ToolError {
    fn from(error: crate::contract::CliError) -> Self {
        match error.hint {
            Some(hint) => ToolError(format!("{} {hint}", error.message)),
            None => ToolError(error.message),
        }
    }
}

/// A group of tools. Other workstreams add theirs to [`TOOL_SETS`].
pub trait McpToolSet: Sync {
    fn tools(&self) -> Vec<ToolMeta>;
    fn call<'a>(
        &'a self,
        name: &'a str,
        args: &'a Value,
        ctx: &'a ToolContext,
    ) -> Option<BoxFuture<'a, Result<Value, ToolError>>>;
}

pub(crate) static TOOL_SETS: &[&dyn McpToolSet] = &[
    &CoreTools,
    // 0.4.8 F3:
    &crate::check::mcp::CheckTools,
];

pub fn all_tools() -> Vec<ToolMeta> {
    TOOL_SETS.iter().flat_map(|set| set.tools()).collect()
}

pub async fn call_tool(name: &str, args: &Value, ctx: &ToolContext) -> Result<Value, ToolError> {
    for set in TOOL_SETS {
        if let Some(future) = set.call(name, args, ctx) {
            return future.await;
        }
    }
    Err(ToolError(format!("There's no tool called {name}.")))
}

pub(crate) struct Hints {
    pub read_only: bool,
    pub destructive: bool,
    pub idempotent: bool,
    pub open_world: bool,
}

pub(crate) const READ: Hints = Hints {
    read_only: true,
    destructive: false,
    idempotent: true,
    open_world: false,
};

pub(crate) fn tool(
    name: &str,
    title: &str,
    description: &str,
    properties: Value,
    required: &[&str],
    output: Value,
    hints: Hints,
) -> ToolMeta {
    let mut meta = ToolMeta::new(
        name,
        description,
        json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        }),
    );
    meta.title = Some(title.to_string());
    meta.output_schema = Some(output);
    meta.annotations = Some(ToolAnnotations {
        title: Some(title.to_string()),
        read_only_hint: Some(hints.read_only),
        destructive_hint: Some(hints.destructive),
        idempotent_hint: Some(hints.idempotent),
        open_world_hint: Some(hints.open_world),
    });
    meta
}

pub(crate) fn object(required: &[&str], properties: Value) -> Value {
    json!({"type": "object", "properties": properties, "required": required})
}

/// The tools every `oleafly mcp` serves.
pub struct CoreTools;

impl McpToolSet for CoreTools {
    fn tools(&self) -> Vec<ToolMeta> {
        let none = json!({});
        vec![
            tool(
                "get_status",
                "Project status",
                "The project this server works on: its folder, main document, engine and how the last build went. Call this first.",
                none.clone(),
                &[],
                object(
                    &["app_version", "project_root", "main_document", "engine", "last_build"],
                    json!({"app_version": {"type": "string"}, "project_root": {"type": "string"}, "main_document": {"type": "string"}, "engine": {"type": "string"}, "project_id": {"type": ["string", "null"]}, "last_build": {}}),
                ),
                READ,
            ),
            tool(
                "project_map",
                "Project map",
                "A structural map of the whole project: the section outline, labels, citation keys, macros, included files, and unresolved references and citations. Call this before cross-cutting edits.",
                none.clone(),
                &[],
                object(
                    &["files", "sections", "labels", "bibKeys", "macros", "theorems", "glossary", "inputGraph", "unresolvedRefs", "unresolvedCites", "ambiguousTypstAtUses"],
                    json!({"files": {"type": "array"}, "sections": {"type": "array"}, "labels": {"type": "array"}, "bibKeys": {"type": "array"}, "macros": {"type": "array"}, "theorems": {"type": "array"}, "glossary": {"type": "array"}, "inputGraph": {"type": "array"}, "unresolvedRefs": {"type": "array"}, "unresolvedCites": {"type": "array"}, "ambiguousTypstAtUses": {"type": "array"}}),
                ),
                READ,
            ),
            tool(
                "context",
                "Project context",
                "Everything `oleafly context` reports: the project map, file roles, unused citations and labels, missing files, packages, the last build, git and checkpoints.",
                none.clone(),
                &[],
                object(&["project", "map", "missing_files", "last_build"], json!({"project": {"type": "object"}, "map": {"type": "object"}, "missing_files": {"type": "array"}, "last_build": {}})),
                READ,
            ),
            tool(
                "compile",
                "Build the PDF",
                "Build the project's PDF with the same compiler the app uses. Returns success, errors with file and line, warnings and typesetting diagnostics (info_omitted counts the informational log lines left out; get_log has them all) and the end of the log. Edit files with your own tools first; this server only reads and builds.",
                none.clone(),
                &[],
                object(
                    &["success", "errors", "diagnostics", "has_pdf", "log_tail", "compile_time_ms"],
                    json!({"success": {"type": "boolean"}, "errors": {"type": "array"}, "diagnostics": {"type": "array"}, "info_omitted": {"type": "integer"}, "has_pdf": {"type": "boolean"}, "pdf": {"type": ["string", "null"]}, "log_tail": {"type": "string"}, "compile_time_ms": {"type": "integer"}}),
                ),
                Hints {
                    read_only: false,
                    destructive: false,
                    idempotent: true,
                    open_world: true,
                },
            ),
            tool(
                "get_log",
                "Build log",
                "The last build's log (its end) and its diagnostics.",
                none.clone(),
                &[],
                object(&["log", "source", "diagnostics"], json!({"log": {"type": "string"}, "source": {"type": "string"}, "diagnostics": {"type": "array"}})),
                READ,
            ),
            tool(
                "list_files",
                "List files",
                "Every file in the project (generated folders left out).",
                none.clone(),
                &[],
                object(&["files", "truncated"], json!({"files": {"type": "array"}, "scanned_entries": {"type": "integer"}, "truncated": {"type": "boolean"}})),
                READ,
            ),
            tool(
                "read_file",
                "Read a file",
                "Read a project file by its path relative to the project, 800 lines at a time. offset is the first line (from 1).",
                json!({
                    "path": {"type": "string", "maxLength": 4096},
                    "offset": {"type": "integer", "minimum": 1},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 800}
                }),
                &["path"],
                object(
                    &["path", "offset", "lines_returned", "total_lines", "truncated", "content"],
                    json!({"path": {"type": "string"}, "offset": {"type": "integer"}, "lines_returned": {"type": "integer"}, "total_lines": {"type": "integer"}, "truncated": {"type": "boolean"}, "content": {"type": "string"}, "encoding": {"type": "string"}}),
                ),
                READ,
            ),
            tool(
                "search_project",
                "Search the project",
                "Find a text in the project's files (case-insensitive). Returns up to 20 matches with their line.",
                json!({"query": {"type": "string", "minLength": 1, "maxLength": 1024}}),
                &["query"],
                object(&["results", "total", "truncated"], json!({"results": {"type": "array"}, "total": {"type": "integer"}, "truncated": {"type": "boolean"}})),
                READ,
            ),
            tool(
                "cite_lookup",
                "Look up a citation",
                "BibTeX for a DOI, arXiv id, ISBN or PubMed id, from the public registries.",
                json!({"id": {"type": "string", "minLength": 1, "maxLength": 256}}),
                &["id"],
                object(&["bibtex", "source"], json!({"bibtex": {"type": "string"}, "source": {"type": "string"}})),
                Hints {
                    read_only: true,
                    destructive: false,
                    idempotent: true,
                    open_world: true,
                },
            ),
            tool(
                "doctor",
                "Check the setup",
                "Check the engines, the app and the project, as `oleafly doctor` does.",
                none,
                &[],
                object(&["ok", "checks"], json!({"ok": {"type": "boolean"}, "checks": {"type": "array"}})),
                READ,
            ),
        ]
    }

    fn call<'a>(
        &'a self,
        name: &'a str,
        args: &'a Value,
        ctx: &'a ToolContext,
    ) -> Option<BoxFuture<'a, Result<Value, ToolError>>> {
        let future: BoxFuture<'a, Result<Value, ToolError>> = match name {
            "get_status" => Box::pin(get_status(ctx)),
            "project_map" => Box::pin(project_map(ctx)),
            "context" => Box::pin(async move {
                let (value, scan) =
                    crate::commands::context::context_value(&ctx.root, ctx.data_root.clone())
                        .await?;
                Ok(bounded_context(value, &scan))
            }),
            "compile" => Box::pin(compile(ctx)),
            "get_log" => Box::pin(async move { get_log(ctx) }),
            "list_files" => Box::pin(async move { list_files(ctx) }),
            "read_file" => Box::pin(async move { read_file(ctx, args) }),
            "search_project" => Box::pin(async move { search_project(ctx, args) }),
            "cite_lookup" => Box::pin(async move {
                let id = string_arg(args, "id")?;
                let (bibtex, source) = crate::commands::cite::lookup_bibtex(id).await?;
                Ok(json!({"bibtex": bibtex, "source": source}))
            }),
            "doctor" => Box::pin(doctor(ctx)),
            _ => return None,
        };
        Some(future)
    }
}

fn string_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, ToolError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| ToolError(format!("{key} is required.")))
}

async fn get_status(ctx: &ToolContext) -> Result<Value, ToolError> {
    let opened = crate::engine::open_project(&ctx.root, None, None)?;
    let workspace = &opened.workspace;
    let last_build = crate::record::read_record(&workspace.build_dir_path()).map_or(Value::Null, |record| {
        json!({"ok": record.ok, "engine": record.engine, "finished_at_ms": record.finished_at_ms, "error_count": record.errors.iter().filter(|error| error.kind == "error").count()})
    });
    let project_id = ctx
        .data_root
        .as_deref()
        .and_then(|data_root| crate::app_paths::project_identity(workspace.root(), data_root))
        .map(|identity| identity.id().to_string());
    Ok(json!({
        "app_version": crate::version::APP_VERSION,
        "project_root": workspace.root(),
        "main_document": workspace.manifest().main_doc,
        "engine": workspace.manifest().engine().map(|engine| engine.canonical_name()).unwrap_or("unknown"),
        "project_id": project_id,
        "last_build": last_build,
    }))
}

async fn project_map(ctx: &ToolContext) -> Result<Value, ToolError> {
    let opened = crate::engine::open_project(&ctx.root, None, None)?;
    let root = opened.workspace.root().to_path_buf();
    let main = opened.workspace.manifest().main_doc.clone();
    let scan = tokio::task::spawn_blocking(move || {
        oleafly_core::context::scan_project(
            &root,
            &main,
            &oleafly_core::context::ContextLimits::default(),
        )
    })
    .await
    .map_err(|error| ToolError(format!("The project scan stopped: {error}")))?
    .map_err(|error| ToolError(error.to_string()))?;
    Ok(oleafly_core::context::map_view(&scan.map))
}

/// `oleafly context --json` cut to fit a client's tool result: file roles
/// counted rather than listed, and each list kept to a few hundred items
/// (`truncated_counts` says what each lost).
fn bounded_context(mut value: Value, scan: &oleafly_core::context::ContextScan) -> Value {
    if let Some(fields) = value.as_object_mut() {
        fields.remove("roles");
        fields.insert(
            "role_counts".into(),
            json!(oleafly_core::context::role_counts(&scan.roles)),
        );
    }
    oleafly_core::context::bounded_view(
        value,
        oleafly_core::context::VIEW_MAX_BYTES,
        "truncated_counts",
    )
}

fn without_info(
    diagnostics: &[oleafly_core::LogDiagnostic],
) -> (Vec<&oleafly_core::LogDiagnostic>, usize) {
    let kept: Vec<_> = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity != oleafly_core::LogSeverity::Info)
        .collect();
    let omitted = diagnostics.len() - kept.len();
    (kept, omitted)
}

async fn compile(ctx: &ToolContext) -> Result<Value, ToolError> {
    let request = crate::engine::BuildRequest {
        timeout: ctx.build_timeout,
        ..crate::engine::BuildRequest::default()
    };
    let result = crate::engine::build_project(&ctx.root, &request).await?;
    let (log_tail, _) = crate::record::tail_chars(&result.log, 4_000);
    let (diagnostics, info_omitted) = without_info(&result.diagnostics);
    Ok(json!({
        "success": result.ok,
        "errors": result.errors,
        "diagnostics": diagnostics,
        "info_omitted": info_omitted,
        "has_pdf": result.output.is_some() || result.previous_output.is_some(),
        "pdf": result.output.as_ref().or(result.previous_output.as_ref()),
        "log_tail": log_tail,
        "compile_time_ms": result.compile_time_ms,
    }))
}

fn get_log(ctx: &ToolContext) -> Result<Value, ToolError> {
    let opened = crate::engine::open_project(&ctx.root, None, None)?;
    let workspace = &opened.workspace;
    let latest =
        crate::record::latest_log(&workspace.build_dir_path(), &workspace.manifest().main_doc)
            .ok_or_else(|| {
                ToolError("This project hasn't been built yet. Call compile first.".into())
            })?;
    let (text, _) = crate::record::read_tail(&latest.path, 100_000, 4 * 1024 * 1024)
        .map_err(|error| ToolError(error.to_string()))?;
    let (log, _) = crate::record::tail_chars(&text, 20_000);
    let diagnostics = latest
        .record
        .as_ref()
        .map(|record| json!(record.diagnostics))
        .unwrap_or_else(|| json!([]));
    Ok(json!({"log": log, "source": latest.source, "diagnostics": diagnostics}))
}

/// Every project file (slash paths), bounded.
fn project_files(root: &Path, limit: usize) -> Result<(Vec<String>, usize, bool), ToolError> {
    let mut files: Vec<String> = Vec::new();
    let mut scanned = 0usize;
    oleafly_core::walk_source_tree(root, "file list", &mut |relative, _| {
        scanned += 1;
        if files.len() < limit {
            files.push(oleafly_core::slash_path(relative));
        }
        Ok(())
    })
    .map_err(|error| ToolError(error.to_string()))?;
    files.sort();
    let truncated = scanned > files.len();
    Ok((files, scanned, truncated))
}

pub(crate) fn list_files(ctx: &ToolContext) -> Result<Value, ToolError> {
    let root = ctx
        .root
        .canonicalize()
        .map_err(|error| ToolError(error.to_string()))?;
    let (files, scanned, truncated) = project_files(&root, ctx.limits.max_list)?;
    let files: Vec<Value> = files
        .into_iter()
        .map(|path| json!({"path": path, "is_dir": false}))
        .collect();
    Ok(json!({"files": files, "scanned_entries": scanned, "truncated": truncated}))
}

/// A path inside the project, or the reason it isn't one.
fn project_file(ctx: &ToolContext, relative: &str) -> Result<PathBuf, ToolError> {
    let outside = || {
        ToolError(format!("{relative} isn't a path inside the project. Use a path relative to the project, with forward slashes."))
    };
    if relative.chars().any(char::is_control) || relative.contains('\\') {
        return Err(outside());
    }
    let root = ctx
        .root
        .canonicalize()
        .map_err(|error| ToolError(error.to_string()))?;
    let path = oleafly_core::resolve_project_path(&root, relative).map_err(|_| outside())?;
    let real = path
        .canonicalize()
        .map_err(|_| ToolError(format!("{relative} doesn't exist.")))?;
    if !real.starts_with(&root) {
        return Err(outside());
    }
    Ok(real)
}

struct TextPage {
    content: String,
    lines_returned: usize,
    total_lines: usize,
    truncated: bool,
}

/// The app's paging (`src-tauri/src/mcp/native.rs`).
fn text_page(body: &str, offset: usize, take: usize, max_chars: usize) -> TextPage {
    let total_lines = body.lines().count();
    let start = offset.saturating_sub(1).min(total_lines);
    let lines_returned = total_lines.saturating_sub(start).min(take);
    let mut content = String::new();
    let mut chars = 0usize;
    let mut char_truncated = false;
    'lines: for (index, line) in body.lines().skip(start).take(take).enumerate() {
        if index > 0 {
            if chars == max_chars {
                char_truncated = true;
                break;
            }
            content.push('\n');
            chars += 1;
        }
        for character in line.chars() {
            if chars == max_chars {
                char_truncated = true;
                break 'lines;
            }
            content.push(character);
            chars += 1;
        }
    }
    TextPage {
        content,
        lines_returned,
        total_lines,
        truncated: char_truncated || start + lines_returned < total_lines,
    }
}

pub(crate) fn read_file(ctx: &ToolContext, args: &Value) -> Result<Value, ToolError> {
    use std::io::Read;
    let relative = string_arg(args, "path")?;
    let path = project_file(ctx, relative)?;
    let metadata = std::fs::metadata(&path).map_err(|error| ToolError(error.to_string()))?;
    if !metadata.is_file() {
        return Err(ToolError(format!("{relative} is a folder.")));
    }
    if metadata.len() > ctx.limits.max_file_bytes {
        return Err(ToolError(format!("{relative} is larger than 16 MiB.")));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .and_then(|file| file.take(ctx.limits.max_file_bytes).read_to_end(&mut bytes))
        .map_err(|error| ToolError(error.to_string()))?;
    let lossy = std::str::from_utf8(&bytes).is_err();
    let body = String::from_utf8_lossy(&bytes);
    let offset = args
        .get("offset")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let take = args
        .get("limit")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .map_or(ctx.limits.max_read_lines, |value| {
            (value as usize).min(ctx.limits.max_read_lines)
        });
    let page = text_page(&body, offset, take, ctx.limits.max_read_chars);
    let mut value = json!({
        "path": relative,
        "offset": offset,
        "lines_returned": page.lines_returned,
        "total_lines": page.total_lines,
        "truncated": page.truncated,
        "content": page.content,
    });
    if lossy {
        value["encoding"] = json!("not UTF-8; unreadable bytes are shown as \u{fffd}");
    }
    Ok(value)
}

fn searchable(path: &str) -> bool {
    let extension = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    oleafly_core::context::is_context_path(path)
        || matches!(
            extension.as_str(),
            "txt" | "csv" | "json" | "yml" | "yaml" | "toml" | "lua" | "py" | "r" | "bst" | "csl"
        )
}

pub(crate) fn search_project(ctx: &ToolContext, args: &Value) -> Result<Value, ToolError> {
    use std::io::Read;
    let query = string_arg(args, "query")?;
    if query.is_empty() {
        return Err(ToolError("query must not be empty.".into()));
    }
    if query.len() > 1024 {
        return Err(ToolError("query is longer than 1 KiB.".into()));
    }
    let needle = query.to_lowercase();
    let root = ctx
        .root
        .canonicalize()
        .map_err(|error| ToolError(error.to_string()))?;
    let (files, _, mut truncated) = project_files(&root, ctx.limits.max_list)?;
    let mut results: Vec<Value> = Vec::new();
    let mut total = 0usize;
    let mut scanned_bytes = 0u64;
    for relative in files.iter().filter(|path| searchable(path)) {
        if scanned_bytes >= ctx.limits.max_search_bytes {
            truncated = true;
            break;
        }
        let mut bytes = Vec::new();
        let budget = (ctx.limits.max_search_bytes - scanned_bytes).min(ctx.limits.max_file_bytes);
        if std::fs::File::open(root.join(relative))
            .and_then(|file| file.take(budget).read_to_end(&mut bytes))
            .is_err()
        {
            continue;
        }
        scanned_bytes += bytes.len() as u64;
        let text = String::from_utf8_lossy(&bytes);
        for (index, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                total += 1;
                if results.len() < ctx.limits.max_search_results {
                    let preview: String = line.trim().chars().take(240).collect();
                    results.push(json!({"path": relative, "line": index + 1, "preview": preview}));
                }
            }
        }
    }
    Ok(json!({"results": results, "total": total, "truncated": truncated || total > results.len()}))
}

async fn doctor(ctx: &ToolContext) -> Result<Value, ToolError> {
    let context = Context::new(ContextOptions {
        project: ctx.root.clone(),
        project_explicit: true,
        json: true,
        data_root: ctx.data_root.clone(),
        command: "doctor",
        ..ContextOptions::default()
    });
    let value = crate::commands::doctor::doctor_value(&context).await?;
    Ok(
        json!({"ok": value["report"]["ok"], "checks": value["report"]["checks"], "scope": value["scope"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(root: &Path) -> ToolContext {
        ToolContext {
            root: root.to_path_buf(),
            data_root: None,
            build_timeout: Duration::from_secs(60),
            limits: ToolLimits::default(),
        }
    }

    #[test]
    fn compile_leaves_informational_log_lines_out_and_counts_them() {
        let diagnostic = |severity, message: &str| oleafly_core::LogDiagnostic {
            severity,
            message: message.into(),
            file: None,
            line: None,
            category: oleafly_core::LogCategory::Info,
            error_context: None,
        };
        let all = vec![
            diagnostic(
                oleafly_core::LogSeverity::Info,
                "LaTeX Font: Trying to load font information",
            ),
            diagnostic(oleafly_core::LogSeverity::Warning, "Citation undefined"),
            diagnostic(oleafly_core::LogSeverity::Info, "Redefining \\frac"),
            diagnostic(oleafly_core::LogSeverity::Typesetting, "Overfull \\hbox"),
            diagnostic(
                oleafly_core::LogSeverity::Error,
                "Undefined control sequence",
            ),
        ];
        let (kept, omitted) = without_info(&all);
        assert_eq!(omitted, 2);
        assert_eq!(
            kept.iter().map(|d| d.message.as_str()).collect::<Vec<_>>(),
            [
                "Citation undefined",
                "Overfull \\hbox",
                "Undefined control sequence"
            ]
        );
    }

    #[test]
    fn tools_list_carries_annotations_and_output_schemas() {
        for tool in all_tools() {
            assert_eq!(
                tool.input_schema["additionalProperties"],
                json!(false),
                "{}",
                tool.name
            );
            assert!(tool.output_schema.is_some(), "{}", tool.name);
            let hints = tool.annotations.clone().unwrap();
            match tool.name.as_str() {
                "compile" => assert_eq!(
                    (
                        hints.read_only_hint,
                        hints.destructive_hint,
                        hints.open_world_hint
                    ),
                    (Some(false), Some(false), Some(true))
                ),
                "cite_lookup" => assert_eq!(hints.open_world_hint, Some(true)),
                _ => assert_eq!(hints.read_only_hint, Some(true), "{}", tool.name),
            }
        }
    }

    #[tokio::test]
    async fn structured_results_contain_every_required_output_key() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("main.tex"),
            "\\documentclass{article}\\section{A}\\label{a}\\ref{a}",
        )
        .unwrap();
        let ctx = context(dir.path());
        let tools = all_tools();
        for name in ["project_map", "get_status", "list_files"] {
            let value = call_tool(name, &json!({}), &ctx).await.unwrap();
            let schema = tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap()
                .output_schema
                .clone()
                .unwrap();
            for key in schema["required"].as_array().unwrap() {
                assert!(
                    value.get(key.as_str().unwrap()).is_some(),
                    "{name} lacks {key}"
                );
            }
        }
    }

    #[tokio::test]
    async fn the_map_and_context_of_a_large_project_stay_small() {
        let dir = tempfile::tempdir().unwrap();
        let bib: String = (0..3_000)
            .map(|index| format!("@misc{{reference-key-number-{index}, title={{T}}}}\n"))
            .collect();
        std::fs::write(dir.path().join("refs.bib"), bib).unwrap();
        std::fs::write(
            dir.path().join("main.tex"),
            "\\documentclass{article}\\cite{ghost}\\bibliography{refs}",
        )
        .unwrap();
        let ctx = context(dir.path());
        let map = call_tool("project_map", &json!({}), &ctx).await.unwrap();
        assert!(map.to_string().len() < 64 * 1024);
        assert!(map["truncatedCounts"]["bibKeys"].as_u64().unwrap() > 0);
        assert_eq!(map["unresolvedCites"], json!(["ghost"]));
        let context = call_tool("context", &json!({}), &ctx).await.unwrap();
        assert!(context.to_string().len() < 64 * 1024);
        assert!(context.get("roles").is_none());
        assert_eq!(context["role_counts"]["bibliography"], 1);
        assert!(
            context["truncated_counts"]["unused_cites"]
                .as_u64()
                .unwrap()
                > 0
        );
    }

    #[test]
    fn read_file_refuses_paths_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.tex"), "one\ntwo\nthree").unwrap();
        let ctx = context(dir.path());
        for bad in ["../x", "/etc/passwd", "C:\\x", "a\\b"] {
            assert!(read_file(&ctx, &json!({"path": bad})).is_err(), "{bad}");
        }
        let page = read_file(&ctx, &json!({"path": "main.tex", "offset": 2, "limit": 1})).unwrap();
        assert_eq!(
            (
                page["content"].clone(),
                page["total_lines"].clone(),
                page["truncated"].clone()
            ),
            (json!("two"), json!(3), json!(true))
        );
    }

    #[test]
    fn list_files_is_bounded_and_flags_truncation() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..10 {
            std::fs::write(dir.path().join(format!("f{index}.tex")), "x").unwrap();
        }
        let mut ctx = context(dir.path());
        ctx.limits.max_list = 3;
        let value = list_files(&ctx).unwrap();
        assert_eq!(value["files"].as_array().unwrap().len(), 3);
        assert_eq!(value["truncated"], true);
    }

    #[test]
    fn search_is_case_insensitive_and_capped_at_20_results() {
        let dir = tempfile::tempdir().unwrap();
        let text: String = (0..30).map(|_| "Hello World\n").collect();
        std::fs::write(dir.path().join("main.tex"), text).unwrap();
        let value = search_project(&context(dir.path()), &json!({"query": "hello"})).unwrap();
        assert_eq!(value["results"].as_array().unwrap().len(), 20);
        assert_eq!(value["total"], 30);
        assert_eq!(value["truncated"], true);
    }
}
