use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use oleafly_core::typst_toolchain::{
    ResolvedTypst, ToolchainVersion, TypstCapabilities, TypstCompileFlag,
};
use serde::Serialize;
use serde_json::Value;

use crate::app_error::AppError;

const QUERY_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_ELEMENTS: usize = 5000;
const MAX_TEXT_CHARS: usize = 300;
const MAX_DIAGNOSTICS: usize = 20;
const MAX_MESSAGE_CHARS: usize = 600;
const CONTENT_FIELDS: &[&str] = &[
    "text",
    "body",
    "child",
    "children",
    "base",
    "tl",
    "bl",
    "t",
    "b",
    "tr",
    "br",
    "num",
    "denom",
    "index",
    "radicand",
    "annotation",
];

pub(crate) const QUERY_SELECTOR: &str =
    "selector(heading).or(figure).or(math.equation.where(block: true)).or(cite)";

pub(crate) const EVAL_EXPRESSION: &str = concat!(
    "query(selector(heading).or(figure).or(math.equation.where(block: true)).or(cite))",
    ".map(e => (",
    "func: repr(e.func()), ",
    "page: e.location().page(), ",
    "label: if e.has(\"label\") { str(e.label) } else { none }, ",
    "level: if e.func() == heading { e.level } else { none }, ",
    "kind: if e.func() == figure { repr(e.kind) } else { none }, ",
    "numbered: if e.has(\"numbering\") { e.numbering != none } else { false }, ",
    "key: if e.func() == cite { str(e.key) } else { none }, ",
    "body: if e.func() == heading or e.func() == math.equation { e.body } else { none }, ",
    "caption: if e.func() == figure and e.caption != none { e.caption.body } else { none }",
    "))"
);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TypstQueryMethod {
    Query,
    Eval,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TypstInsightKind {
    Heading,
    Figure,
    Equation,
    Citation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstInsightElement {
    pub kind: TypstInsightKind,
    pub text: String,
    pub label: Option<String>,
    pub level: Option<u32>,
    pub figure_kind: Option<String>,
    pub numbered: bool,
    pub page: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstQueryDiagnostic {
    pub message: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TypstDocumentInsights {
    Ready {
        typst_version: String,
        method: TypstQueryMethod,
        elements: Vec<TypstInsightElement>,
        truncated: bool,
    },
    Failed {
        typst_version: String,
        method: TypstQueryMethod,
        diagnostics: Vec<TypstQueryDiagnostic>,
    },
}

pub(crate) fn query_method(version: &ToolchainVersion) -> TypstQueryMethod {
    if (version.major, version.minor) >= (0, 15) {
        TypstQueryMethod::Eval
    } else {
        TypstQueryMethod::Query
    }
}

fn world_flags(capabilities: &TypstCapabilities, flags: &[TypstCompileFlag]) -> Vec<OsString> {
    let mut arguments = Vec::new();
    for flag in flags {
        if !capabilities.supports_flag(flag.name()) {
            continue;
        }
        let value = match flag {
            TypstCompileFlag::PackagePath(path)
            | TypstCompileFlag::PackageCachePath(path)
            | TypstCompileFlag::FontPath(path) => Some(path.as_os_str().to_owned()),
            TypstCompileFlag::Input { key, value } => Some(format!("{key}={value}").into()),
            TypstCompileFlag::IgnoreSystemFonts => None,
            _ => continue,
        };
        arguments.push(OsString::from(flag.name()));
        arguments.extend(value);
    }
    arguments
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TypstQueryTarget<'a> {
    Eval(&'a str),
    Query {
        selector: &'a str,
        field: Option<&'a str>,
    },
}

pub(crate) fn query_args(
    target: &TypstQueryTarget<'_>,
    capabilities: &TypstCapabilities,
    root: &Path,
    main_doc: &str,
    flags: &[TypstCompileFlag],
) -> Vec<OsString> {
    let mut arguments: Vec<OsString> = Vec::new();
    if capabilities.supports_flag("--color") {
        arguments.push("--color=never".into());
    }
    match target {
        TypstQueryTarget::Eval(_) => {
            arguments.extend(["eval".into(), "--in".into(), main_doc.into()]);
        }
        TypstQueryTarget::Query { selector, field } => {
            arguments.extend(["query".into(), main_doc.into(), (*selector).into()]);
            if let Some(field) = field {
                arguments.extend(["--field".into(), (*field).into()]);
            }
        }
    }
    arguments.extend([
        "--root".into(),
        root.as_os_str().to_owned(),
        "--format".into(),
        "json".into(),
        "--diagnostic-format".into(),
        "short".into(),
    ]);
    arguments.extend(world_flags(capabilities, flags));
    if let TypstQueryTarget::Eval(expression) = target {
        arguments.extend(["--".into(), (*expression).into()]);
    }
    arguments
}

fn insight_target(method: TypstQueryMethod) -> TypstQueryTarget<'static> {
    match method {
        TypstQueryMethod::Eval => TypstQueryTarget::Eval(EVAL_EXPRESSION),
        TypstQueryMethod::Query => TypstQueryTarget::Query {
            selector: QUERY_SELECTOR,
            field: None,
        },
    }
}

fn push_text(value: &Value, out: &mut String) {
    if out.chars().count() >= MAX_TEXT_CHARS * 2 {
        return;
    }
    match value {
        Value::String(text) => out.push_str(text),
        Value::Array(items) => items.iter().for_each(|item| push_text(item, out)),
        Value::Object(object) => {
            match object.get("func").and_then(Value::as_str) {
                Some("space" | "linebreak" | "parbreak") => {
                    out.push(' ');
                    return;
                }
                Some("smartquote") => {
                    let double = object
                        .get("double")
                        .and_then(Value::as_bool)
                        .unwrap_or(true);
                    out.push(if double { '"' } else { '\'' });
                    return;
                }
                _ => {}
            }
            for field in CONTENT_FIELDS {
                if let Some(inner) = object.get(*field) {
                    push_text(inner, out);
                }
            }
        }
        _ => {}
    }
}

pub(crate) fn plain_text(value: &Value) -> String {
    let mut raw = String::new();
    push_text(value, &mut raw);
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_TEXT_CHARS {
        return collapsed;
    }
    let mut cut: String = collapsed.chars().take(MAX_TEXT_CHARS).collect();
    cut.push('…');
    cut
}

fn bare_label(text: &str) -> String {
    text.strip_prefix('<')
        .and_then(|inner| inner.strip_suffix('>'))
        .unwrap_or(text)
        .to_owned()
}

fn numbered(object: &serde_json::Map<String, Value>) -> bool {
    match object.get("numbered") {
        Some(Value::Bool(numbered)) => *numbered,
        _ => object
            .get("numbering")
            .is_some_and(|numbering| !numbering.is_null()),
    }
}

pub(crate) fn element_from_json(value: &Value) -> Option<TypstInsightElement> {
    let object = value.as_object()?;
    let kind = match object.get("func")?.as_str()? {
        "heading" => TypstInsightKind::Heading,
        "figure" => TypstInsightKind::Figure,
        "equation" => TypstInsightKind::Equation,
        "cite" => TypstInsightKind::Citation,
        _ => return None,
    };
    let label = object.get("label").and_then(Value::as_str).map(bare_label);
    let text = match kind {
        TypstInsightKind::Citation => bare_label(object.get("key")?.as_str()?),
        TypstInsightKind::Figure => object
            .get("caption")
            .map(
                |caption| match caption.get("func").and_then(Value::as_str) {
                    Some("caption") => caption.get("body").map(plain_text).unwrap_or_default(),
                    _ => plain_text(caption),
                },
            )
            .unwrap_or_default(),
        TypstInsightKind::Heading | TypstInsightKind::Equation => {
            object.get("body").map(plain_text).unwrap_or_default()
        }
    };
    Some(TypstInsightElement {
        kind,
        text,
        label,
        level: object
            .get("level")
            .and_then(Value::as_u64)
            .and_then(|level| u32::try_from(level).ok()),
        figure_kind: object
            .get("kind")
            .and_then(Value::as_str)
            .map(|kind| kind.trim_matches('"').to_owned()),
        numbered: numbered(object),
        page: object
            .get("page")
            .and_then(Value::as_u64)
            .and_then(|page| u32::try_from(page).ok()),
    })
}

pub(crate) fn parse_elements(json: &str) -> Result<(Vec<TypstInsightElement>, bool), String> {
    let values: Vec<Value> = serde_json::from_str(json.trim())
        .map_err(|error| format!("Typst returned output Oleafly could not read: {error}"))?;
    let truncated = values.len() > MAX_ELEMENTS;
    let elements = values
        .iter()
        .take(MAX_ELEMENTS)
        .filter_map(element_from_json)
        .collect();
    Ok((elements, truncated))
}

fn bounded(message: &str) -> String {
    message.trim().chars().take(MAX_MESSAGE_CHARS).collect()
}

fn diagnostic_line(line: &str) -> Option<TypstQueryDiagnostic> {
    let line = line.trim_end();
    if let Some(message) = line.strip_prefix("error: ") {
        return Some(TypstQueryDiagnostic {
            message: bounded(message),
            file: None,
            line: None,
            column: None,
        });
    }
    let (location, message) = line.split_once(": error: ")?;
    let mut fields = location.rsplitn(3, ':');
    let column = fields.next().and_then(|value| value.parse::<u32>().ok());
    let row = fields.next().and_then(|value| value.parse::<u32>().ok());
    let file = fields.next().filter(|_| row.is_some() && column.is_some());
    Some(TypstQueryDiagnostic {
        message: bounded(message),
        file: file.map(|file| file.trim_start_matches("./").replace('\\', "/")),
        line: file.and(row),
        column: file.and(column),
    })
}

pub(crate) fn parse_failure(log: &str, code: Option<i32>) -> Vec<TypstQueryDiagnostic> {
    let mut diagnostics: Vec<TypstQueryDiagnostic> = log
        .lines()
        .filter_map(diagnostic_line)
        .take(MAX_DIAGNOSTICS)
        .collect();
    if diagnostics.is_empty() {
        let message = log
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with("warning:"))
            .map(bounded)
            .unwrap_or_else(|| match code {
                Some(code) => format!("Typst stopped with exit code {code}."),
                None => "Typst stopped before it finished.".into(),
            });
        diagnostics.push(TypstQueryDiagnostic {
            message,
            file: None,
            line: None,
            column: None,
        });
    }
    diagnostics
}

pub(crate) struct TypstQueryContext<'a> {
    pub typst: &'a ResolvedTypst,
    pub root: &'a Path,
    pub main_doc: &'a str,
    pub packages: Option<&'a crate::typst_packages::TypstPackageDirs>,
    pub settings: Option<&'a crate::typst_options::TypstCompileSettings>,
    pub offline: bool,
}

pub(crate) struct ProjectTypst {
    pub typst: Arc<ResolvedTypst>,
    pub root: PathBuf,
    pub main_doc: String,
    pub packages: Option<crate::typst_packages::TypstPackageDirs>,
    pub settings: Option<crate::typst_options::TypstCompileSettings>,
}

impl ProjectTypst {
    pub(crate) fn context(&self, offline: bool) -> TypstQueryContext<'_> {
        TypstQueryContext {
            typst: &self.typst,
            root: &self.root,
            main_doc: &self.main_doc,
            packages: self.packages.as_ref(),
            settings: self.settings.as_ref(),
            offline,
        }
    }
}

pub(crate) fn project_typst(
    project_id: &str,
    variant: Option<&str>,
) -> Result<Option<ProjectTypst>, String> {
    let (meta, root) = {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
        let meta = crate::trust::restrict_compile_meta(
            project_id,
            crate::project::read_meta(project_id)?,
        )?;
        (meta, crate::project_location::locate(project_id)?.root)
    };
    let Some(typst) = crate::typst_toolchain::resolve_for_compile(&meta)? else {
        return Ok(None);
    };
    let packages = crate::typst_packages::for_compile(&meta, &root)?;
    let settings = crate::typst_options::for_compile(&meta, &root, variant);
    Ok(Some(ProjectTypst {
        typst,
        root,
        main_doc: meta.main_doc,
        packages,
        settings,
    }))
}

pub(crate) fn run_query(
    context: &TypstQueryContext<'_>,
    target: &TypstQueryTarget<'_>,
    timeout: Duration,
) -> std::io::Result<std::process::Output> {
    let typst = context.typst;
    let mut flags = context
        .packages
        .map(|packages| packages.compile_flags(&typst.capabilities))
        .unwrap_or_default();
    if let Some(settings) = context.settings {
        flags.extend(settings.compile_flags(&typst.capabilities));
    }
    let mut command = Command::new(&typst.path);
    command
        .args(query_args(
            target,
            &typst.capabilities,
            context.root,
            context.main_doc,
            &flags,
        ))
        .current_dir(context.root);
    for (name, value) in context
        .packages
        .map(crate::typst_packages::TypstPackageDirs::environment)
        .unwrap_or_default()
    {
        command.env(name, value);
    }
    if context.offline {
        for (name, value) in crate::typst_packages::offline_environment() {
            command.env(name, value);
        }
    }
    crate::proc::output_contained_with_timeout(command, timeout)
}

fn relative_to_root(
    diagnostics: Vec<TypstQueryDiagnostic>,
    root: &Path,
) -> Vec<TypstQueryDiagnostic> {
    let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    diagnostics
        .into_iter()
        .map(|mut diagnostic| {
            diagnostic.file = diagnostic.file.map(|file| {
                let file = oleafly_core::typst_log::typst_path_relative_to(&file, &canonical);
                oleafly_core::typst_log::typst_path_relative_to(&file, root)
            });
            diagnostic
        })
        .collect()
}

pub(crate) fn run_insights(
    context: &TypstQueryContext<'_>,
    timeout: Duration,
) -> Result<TypstDocumentInsights, String> {
    let typst = context.typst;
    let method = query_method(&typst.version);
    let output = run_query(context, &insight_target(method), timeout).map_err(|error| {
        if error.kind() == std::io::ErrorKind::TimedOut {
            AppError::new("typst_query.timeout").to_string()
        } else {
            AppError::new("typst_query.failed")
                .detail(error)
                .to_string()
        }
    })?;
    let typst_version = typst.version.to_string();
    if !output.status.success() {
        let log = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        );
        return Ok(TypstDocumentInsights::Failed {
            typst_version,
            method,
            diagnostics: relative_to_root(parse_failure(&log, output.status.code()), context.root),
        });
    }
    let (elements, truncated) = parse_elements(&String::from_utf8_lossy(&output.stdout))?;
    Ok(TypstDocumentInsights::Ready {
        typst_version,
        method,
        elements,
        truncated,
    })
}

fn insights_blocking(
    project_id: &str,
    offline: bool,
    variant: Option<&str>,
) -> Result<TypstDocumentInsights, String> {
    let project = project_typst(project_id, variant)?
        .ok_or_else(|| String::from(AppError::new("typst_toolchain.not_typst_project")))?;
    run_insights(&project.context(offline), QUERY_TIMEOUT)
}

#[tauri::command]
pub async fn typst_document_insights(
    project_id: String,
    offline: Option<bool>,
    typst_variant: Option<String>,
) -> Result<TypstDocumentInsights, String> {
    let offline = offline.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        insights_blocking(&project_id, offline, typst_variant.as_deref())
    })
    .await
    .map_err(|error| format!("the Typst query task stopped: {error}"))?
}

#[cfg(test)]
mod tests;
