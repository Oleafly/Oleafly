use serde_json::{json, Value};

const MAX_SEARCH_RESULTS: usize = 20;
const MAX_READ_LINES: usize = 800;
const MAX_READ_CHARS: usize = 40_000;

const READ_ONLY: &[&str] = &["read_file", "list_files", "search_project"];
const AUTO_APPROVABLE: &[&str] = &[
    "write_file",
    "replace_in_file",
    "create_file",
    "rename_file",
];
const ALWAYS_CONFIRM: &[&str] = &["delete_file"];

pub fn handles(name: &str, approval_policy: &str) -> bool {
    if READ_ONLY.contains(&name) {
        return true;
    }
    match approval_policy {
        "trust" => AUTO_APPROVABLE.contains(&name) || ALWAYS_CONFIRM.contains(&name),
        "auto_writes" => AUTO_APPROVABLE.contains(&name),
        _ => false,
    }
}

fn arg<'a>(arguments: &'a Value, key: &str) -> Option<&'a str> {
    arguments.get(key).and_then(|v| v.as_str())
}

pub fn resolve_project(arguments: &Value, reported: Option<String>) -> Result<String, String> {
    if let Some(explicit) = arg(arguments, "project_id") {
        crate::paths::validate_project_id(explicit)?;
        return Ok(explicit.to_string());
    }
    if let Some(open) = reported.filter(|p| !p.is_empty()) {
        return Ok(open);
    }
    most_recent_project()
}

fn most_recent_project() -> Result<String, String> {
    let root = crate::paths::projects_root()?;
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for entry in std::fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if crate::paths::validate_project_id(&name).is_err() {
            continue;
        }
        if !entry.path().join("project.json").is_file() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            best = Some((modified, name));
        }
    }
    best.map(|(_, name)| name)
        .ok_or_else(|| "no project is open and none was found on disk".to_string())
}

fn required<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arg(arguments, key).ok_or_else(|| format!("missing required argument: {key}"))
}

fn payload(value: Value) -> Value {
    json!({ "content": [{ "type": "text", "text": value.to_string() }] })
}

pub async fn call(project_id: &str, name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        "read_file" => read_file(project_id, arguments),
        "write_file" => write_file(project_id, arguments).await,
        "replace_in_file" => replace_in_file(project_id, arguments).await,
        "create_file" => create_file(project_id, arguments),
        "delete_file" => delete_file(project_id, arguments),
        "rename_file" => rename_file(project_id, arguments),
        "list_files" => list_files(project_id).await,
        "search_project" => search_project(project_id, arguments).await,
        other => Err(format!("{other} is not handled natively")),
    }
}

fn read_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let body = crate::project::read_file(project_id.to_string(), path.to_string())?;
    let all: Vec<&str> = body.lines().collect();
    let offset = arguments
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .max(1) as usize;
    let start = (offset - 1).min(all.len());
    let take = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
        .map(|v| v as usize)
        .unwrap_or(MAX_READ_LINES)
        .min(MAX_READ_LINES);
    let slice: Vec<&str> = all.iter().skip(start).take(take).copied().collect();
    let mut content = slice.join("\n");
    let mut truncated = start + slice.len() < all.len();
    if content.chars().count() > MAX_READ_CHARS {
        content = content.chars().take(MAX_READ_CHARS).collect();
        truncated = true;
    }
    Ok(payload(json!({
        "path": path,
        "offset": offset,
        "lines_returned": slice.len(),
        "total_lines": all.len(),
        "truncated": truncated,
        "content": content,
    })))
}

async fn write_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let content = required(arguments, "content")?;
    crate::project::write_file(
        project_id.to_string(),
        path.to_string(),
        content.to_string(),
    )
    .await?;
    Ok(payload(
        json!({ "success": true, "path": path, "bytes": content.len() }),
    ))
}

async fn replace_in_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let find = required(arguments, "find")?;
    let replace = required(arguments, "replace")?;
    let all = arguments
        .get("replace_all")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let body = crate::project::read_file(project_id.to_string(), path.to_string())?;
    if !body.contains(find) {
        return Err(format!("no match for the search text in {path}"));
    }
    let updated = if all {
        body.replace(find, replace)
    } else {
        body.replacen(find, replace, 1)
    };
    let replacements = if all { body.matches(find).count() } else { 1 };
    crate::project::write_file(project_id.to_string(), path.to_string(), updated).await?;
    Ok(payload(
        json!({ "success": true, "path": path, "replacements": replacements }),
    ))
}

fn create_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let is_dir = arguments
        .get("is_dir")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    crate::project::create_file(project_id.to_string(), path.to_string(), is_dir)?;
    Ok(payload(
        json!({ "success": true, "path": path, "is_dir": is_dir }),
    ))
}

fn delete_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    crate::project::delete_file(project_id.to_string(), path.to_string())?;
    Ok(payload(json!({ "success": true, "path": path })))
}

fn rename_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let from = required(arguments, "from")?;
    let to = required(arguments, "to")?;
    crate::project::rename_file(
        project_id.to_string(),
        from.to_string(),
        to.to_string(),
        None,
    )?;
    Ok(payload(json!({ "success": true, "from": from, "to": to })))
}

async fn list_files(project_id: &str) -> Result<Value, String> {
    let entries = crate::project::list_files(project_id.to_string()).await?;
    let files: Vec<Value> = entries
        .iter()
        .map(|e| json!({ "path": e.path, "is_dir": e.is_dir }))
        .collect();
    Ok(payload(json!({ "files": files })))
}

async fn search_project(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let query = required(arguments, "query")?;
    if query.is_empty() {
        return Err("query must not be empty".into());
    }
    let hits = crate::project::search_project(project_id.to_string(), query.to_string()).await?;
    let total = hits.len();
    let results: Vec<Value> = hits
        .into_iter()
        .take(MAX_SEARCH_RESULTS)
        .map(|hit| {
            json!({
                "project_id": hit.project_id,
                "project_name": hit.project_name,
                "path": hit.path,
                "line": hit.line,
                "preview": hit.preview,
            })
        })
        .collect();
    Ok(payload(json!({ "results": results, "total": total })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_never_need_a_prompt_under_any_policy() {
        for policy in ["ask", "auto_writes", "trust"] {
            for name in ["read_file", "list_files", "search_project"] {
                assert!(handles(name, policy), "{name} under {policy}");
            }
        }
    }

    #[test]
    fn the_default_policy_sends_every_change_to_the_app_to_be_approved() {
        for name in [
            "write_file",
            "replace_in_file",
            "create_file",
            "rename_file",
            "delete_file",
        ] {
            assert!(
                !handles(name, "ask"),
                "{name} must be approved before it runs"
            );
        }
    }

    #[test]
    fn auto_writes_still_stops_at_a_delete() {
        for name in [
            "write_file",
            "replace_in_file",
            "create_file",
            "rename_file",
        ] {
            assert!(handles(name, "auto_writes"), "{name} is auto approvable");
        }
        assert!(
            !handles("delete_file", "auto_writes"),
            "a delete always needs a click"
        );
    }

    #[test]
    fn trust_permits_every_change_including_a_delete() {
        for name in ["write_file", "delete_file", "rename_file"] {
            assert!(handles(name, "trust"), "{name} under trust");
        }
    }

    #[test]
    fn an_unknown_policy_is_treated_as_the_strictest_one() {
        assert!(!handles("write_file", ""));
        assert!(!handles("write_file", "nonsense"));
    }

    #[test]
    fn tools_that_need_the_interface_never_run_natively() {
        for policy in ["ask", "auto_writes", "trust"] {
            for name in [
                "verify_pdf_pages",
                "preview_figure",
                "insert_figure",
                "toggle_theme",
                "set_main_doc",
            ] {
                assert!(!handles(name, policy), "{name} under {policy}");
            }
        }
    }

    #[test]
    fn an_explicit_project_argument_wins_over_whatever_is_open() {
        let arguments = json!({ "project_id": "swift-violet-fox" });
        assert_eq!(
            resolve_project(&arguments, Some("other-project".into())).unwrap(),
            "swift-violet-fox"
        );
    }

    #[test]
    fn a_traversal_project_id_is_refused() {
        let arguments = json!({ "project_id": "../../etc" });
        assert!(resolve_project(&arguments, None).is_err());
    }

    #[test]
    fn the_open_project_is_used_when_the_call_names_none() {
        assert_eq!(
            resolve_project(&json!({}), Some("open-one".into())).unwrap(),
            "open-one"
        );
    }

    #[test]
    fn a_blank_reported_project_does_not_count_as_open() {
        match resolve_project(&json!({}), Some(String::new())) {
            Ok(id) => assert!(!id.is_empty()),
            Err(error) => assert!(!error.is_empty()),
        }
    }

    #[test]
    fn a_missing_required_argument_is_named_in_the_error() {
        let err = required(&json!({}), "path").unwrap_err();
        assert!(err.contains("path"));
    }

    #[test]
    fn results_carry_a_json_document_in_the_mcp_text_block() {
        let value = payload(json!({ "path": "main.tex", "content": "body" }));
        assert_eq!(value["content"][0]["type"], "text");

        let inner: Value =
            serde_json::from_str(value["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(inner["path"], "main.tex");
        assert_eq!(inner["content"], "body");
    }
}
