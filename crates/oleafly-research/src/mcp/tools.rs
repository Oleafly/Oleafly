use std::sync::Arc;

use serde_json::{json, Value};

use super::protocol::ToolMeta;
use super::{files, Context};

const MAX_RESULT_BYTES: usize = 512 * 1024;

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> ToolMeta {
    ToolMeta::new(
        name,
        description,
        json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        }),
    )
}

pub fn tool_definitions() -> Vec<ToolMeta> {
    let path = json!({"type": "string", "maxLength": 4096});
    let id = json!({"type": "string", "minLength": 1, "maxLength": 256});
    let query = json!({"type": "string", "minLength": 1, "maxLength": 500});
    let bytes = json!({"type": "integer", "minimum": 1, "maximum": files::MAX_READ_BYTES});
    let depth = json!({"type": "integer", "minimum": 0, "maximum": 5});
    vec![
        tool("research_context", "List the linked folders available to this session. Use their IDs for read-only access.", json!({}), &[]),
        tool("read_file", "Read a text file inside this session's working folder.", json!({"path": path, "max_bytes": bytes}), &["path"]),
        tool("list_files", "List files inside this session's working folder. Paths are relative to that folder.", json!({"path": path, "max_depth": depth}), &[]),
        tool("search_project", "Search this session's text files for a literal, case-sensitive phrase.", json!({"query": query}), &["query"]),
        tool("list_linked_files", "List a linked folder by its ID. Linked folders are read-only in this session.", json!({"root_id": id, "path": path, "max_depth": depth}), &["root_id"]),
        tool("read_linked_file", "Read a text file from a linked folder by its ID and relative path.", json!({"root_id": id, "path": path, "max_bytes": bytes}), &["root_id", "path"]),
        tool("literature_search", "Search a scholarly index. This sends only the supplied query and filters to the selected service.", json!({
            "source": {"type": "string", "enum": ["openalex", "semantic-scholar", "crossref", "pubmed", "arxiv", "google-scholar"]},
            "query": query,
            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
            "year_from": {"type": "integer", "minimum": 1000, "maximum": 2200},
            "year_to": {"type": "integer", "minimum": 1000, "maximum": 2200},
            "open_access_only": {"type": "boolean"},
        }), &["source", "query"]),
        tool("literature_arxiv_lookup", "Look up an arXiv paper by ID. Returns the source metadata.", json!({"arxiv_id": id}), &["arxiv_id"]),
        tool("fetch_doi_bibtex", "Fetch a DOI's BibTeX entry from doi.org.", json!({"doi": {"type": "string", "minLength": 1, "maxLength": 2048}}), &["doi"]),
        tool("fetch_arxiv", "Fetch an arXiv entry by ID as Atom XML.", json!({"id": id}), &["id"]),
        tool("crossref_search", "Search Crossref for citation metadata using the supplied bibliographic query.", json!({"query": query}), &["query"]),
        tool("list_skills", "List valid research skills installed in Oleafly and their enabled state.", json!({}), &[]),
        tool("load_skill", "Load one skill: its full instructions, the absolute folder path, the list of supporting files, and a ready to run command for each bundled script.", json!({"id": id}), &["id"]),
        tool("read_skill_file", "Read a support file from an enabled skill by ID and relative path.", json!({"id": id, "path": path}), &["id", "path"]),
    ]
}

/// The tools this session lists: the research tools, plus a task's own tools
/// when the session belongs to a research task (they replace the
/// single-index literature search).
pub(super) fn session_tools(context: &Context) -> Vec<ToolMeta> {
    let Some(binding) = &context.task else {
        return tool_definitions();
    };
    let task: Vec<ToolMeta> = task_tools(binding);
    let mut tools: Vec<ToolMeta> = tool_definitions()
        .into_iter()
        .filter(|tool| !task.iter().any(|own| own.name == tool.name))
        .collect();
    tools.extend(task);
    tools
}

fn task_tools(binding: &crate::task_tools::extra::TaskBinding) -> Vec<ToolMeta> {
    crate::task_tools::extra::task_tool_schemas(&binding.brief, binding.host.web().is_some())
        .into_iter()
        // A CLI agent starts its own helpers.
        .filter(|tool| tool.name != crate::task_tools::extra::SPAWN_AGENT)
        .map(|tool| ToolMeta::new(tool.name, tool.description, tool.input_schema))
        .collect()
}

/// A task tool this session serves.
pub(super) fn is_task_tool(context: &Context, name: &str) -> bool {
    context
        .task
        .as_ref()
        .is_some_and(|binding| task_tools(binding).iter().any(|tool| tool.name == name))
}

pub(super) fn validate(name: &str, arguments: &Value) -> Result<(), String> {
    let definition = tool_definitions()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or_else(|| "This tool is not available in the research session.".to_string())?;
    let arguments = arguments
        .as_object()
        .ok_or_else(|| "Tool arguments must be a JSON object.".to_string())?;
    let properties = definition.input_schema["properties"]
        .as_object()
        .ok_or_else(|| "This tool has no argument schema.".to_string())?;
    for key in definition.input_schema["required"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if !arguments.contains_key(key) {
            return Err(format!("Missing required argument: {key}."));
        }
    }
    for (key, value) in arguments {
        let schema = properties
            .get(key)
            .ok_or_else(|| format!("Argument {key} is not accepted by this tool."))?;
        let valid = match schema["type"].as_str() {
            Some("string") => value.as_str().is_some_and(|value| {
                let length = value.chars().count() as u64;
                length >= schema["minLength"].as_u64().unwrap_or(0)
                    && length <= schema["maxLength"].as_u64().unwrap_or(u64::MAX)
                    && !value.contains('\0')
            }),
            Some("integer") => value.as_u64().is_some_and(|value| {
                value >= schema["minimum"].as_u64().unwrap_or(0)
                    && value <= schema["maximum"].as_u64().unwrap_or(u64::MAX)
            }),
            Some("boolean") => value.is_boolean(),
            _ => false,
        };
        if !valid
            || schema["enum"]
                .as_array()
                .is_some_and(|allowed| !allowed.contains(value))
        {
            return Err(format!("Argument {key} has an invalid value."));
        }
    }
    Ok(())
}

fn string<'a>(arguments: &'a Value, name: &str) -> &'a str {
    arguments[name].as_str().unwrap_or("")
}

fn number(arguments: &Value, name: &str, default: usize) -> usize {
    arguments[name]
        .as_u64()
        .map_or(default, |value| value as usize)
}

pub(super) fn payload(value: Value) -> Result<Value, String> {
    let text = serde_json::to_string(&value)
        .map_err(|_| "The tool result could not be encoded.".to_string())?;
    if text.len() > MAX_RESULT_BYTES {
        return Err("The result is too large. Narrow the query or read fewer bytes.".into());
    }
    Ok(json!({"content": [{"type": "text", "text": text}], "isError": false}))
}

fn source_payload(body: String) -> Result<Value, String> {
    if body.len() > MAX_RESULT_BYTES / 2 {
        return Err(
            "The source returned too much data. Narrow the query or reduce the limit.".into(),
        );
    }
    let data = serde_json::from_str::<Value>(&body).unwrap_or(Value::String(body));
    payload(json!({"data": data}))
}

pub(super) async fn execute(
    context: Arc<Context>,
    name: String,
    arguments: Value,
) -> Result<Value, String> {
    match name.as_str() {
        "literature_search" => source_payload(
            crate::literature::literature_search(
                context.services.secrets.as_ref(),
                string(&arguments, "source"),
                string(&arguments, "query"),
                number(&arguments, "limit", 10) as u8,
                arguments["year_from"].as_u64().map(|year| year as u16),
                arguments["year_to"].as_u64().map(|year| year as u16),
                arguments["open_access_only"].as_bool().unwrap_or(false),
            )
            .await
            .map_err(String::from)?,
        ),
        "literature_arxiv_lookup" => source_payload(
            crate::literature::literature_arxiv_lookup(
                context.services.secrets.as_ref(),
                string(&arguments, "arxiv_id"),
            )
            .await?,
        ),
        "fetch_doi_bibtex" => {
            source_payload(crate::citation::fetch_doi_bibtex(string(&arguments, "doi")).await?)
        }
        "fetch_arxiv" => {
            source_payload(crate::citation::fetch_arxiv(string(&arguments, "id")).await?)
        }
        "crossref_search" => {
            source_payload(crate::citation::crossref_search(string(&arguments, "query")).await?)
        }
        _ => tokio::task::spawn_blocking(move || execute_local(&context, &name, &arguments))
            .await
            .map_err(|_| "The research tool stopped before it returned a result.".to_string())?,
    }
}

fn linked_scope(context: &Context, root_id: &str) -> Result<files::FileScope, String> {
    let saved = context
        .linked_roots
        .iter()
        .find(|root| root.id == root_id)
        .ok_or_else(|| "This linked folder was not granted to the session.".to_string())?;
    let current = context
        .services
        .linked
        .resolve(&context.project_id, root_id)?;
    if current.to_string_lossy() != saved.canonical_path {
        return Err("The linked folder changed after this session started.".into());
    }
    files::FileScope::open(&current, None)
}

pub(super) fn linked_file_result(mut result: Value, root_id: &str, relative_path: &str) -> Value {
    if let Some(result) = result.as_object_mut() {
        result.insert("root_id".into(), json!(root_id));
        result.insert("relative_path".into(), json!(relative_path));
    }
    result
}

fn execute_local(context: &Context, name: &str, arguments: &Value) -> Result<Value, String> {
    if context.closed.load(std::sync::atomic::Ordering::Acquire) {
        return Err("This research session has closed.".into());
    }
    let value = match name {
        "research_context" => json!({
            "project_id": context.project_id,
            "file_access": "session_working_folder",
            "linked_roots": context.linked_roots.iter().map(|root| json!({
                "root_id": root.id,
                "label": root.label,
                "role": root.role,
                "access": "read_only",
            })).collect::<Vec<_>>(),
        }),
        "read_file" => context.files.read(
            string(arguments, "path"),
            number(arguments, "max_bytes", 32 * 1024),
        )?,
        "list_files" => context.files.list(
            string(arguments, "path"),
            number(arguments, "max_depth", 2),
            &context.closed,
        )?,
        "search_project" => context
            .files
            .search(string(arguments, "query"), &context.closed)?,
        "list_linked_files" => linked_scope(context, string(arguments, "root_id"))?.list(
            string(arguments, "path"),
            number(arguments, "max_depth", 2),
            &context.closed,
        )?,
        "read_linked_file" => {
            let root_id = string(arguments, "root_id");
            let relative_path = string(arguments, "path");
            let result = linked_scope(context, root_id)?
                .read(relative_path, number(arguments, "max_bytes", 32 * 1024))?;
            linked_file_result(result, root_id, relative_path)
        }
        "list_skills" => json!({"skills": context.services.skills.list(&context.project_id)?}),
        "load_skill" => context
            .services
            .skills
            .load(&context.project_id, string(arguments, "id"))?,
        "read_skill_file" => context.services.skills.read_file(
            &context.project_id,
            string(arguments, "id"),
            string(arguments, "path"),
        )?,
        _ => return Err("This tool is not available in the research session.".into()),
    };
    payload(value)
}
