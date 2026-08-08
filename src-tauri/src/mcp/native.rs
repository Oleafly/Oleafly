use serde_json::{json, Value};

const MAX_SEARCH_RESULTS: usize = 20;
const MAX_SEARCH_QUERY_BYTES: usize = 1_024;
const MAX_READ_LINES: usize = 800;
const MAX_READ_CHARS: usize = 40_000;
const MAX_READ_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_MUTATED_FILE_BYTES: usize = 16 * 1024 * 1024;

const READ_ONLY: &[&str] = &["read_file", "list_files", "search_project"];

const NATIVE_MUTATING: &[&str] = &[
    "write_file",
    "replace_in_file",
    "create_file",
    "rename_file",
];

const MUTATING: &[&str] = &[
    "write_file",
    "replace_in_file",
    "create_file",
    "rename_file",
    "delete_file",
    "set_main_doc",
    "insert_figure",
    "toggle_theme",
    "open_project",
    "update_todos",
    "remember_note",
    "forget_note",
];

pub fn is_mutating(name: &str) -> bool {
    MUTATING.contains(&name)
}

pub fn handles(name: &str, approval_policy: &str) -> bool {
    if READ_ONLY.contains(&name) {
        return true;
    }
    match approval_policy {
        "trust" => NATIVE_MUTATING.contains(&name),
        "auto_writes" => NATIVE_MUTATING.contains(&name) && name != "delete_file",
        _ => false,
    }
}

fn arg<'a>(arguments: &'a Value, key: &str) -> Option<&'a str> {
    arguments.get(key).and_then(|v| v.as_str())
}

pub fn resolve_project(arguments: &Value, reported: Option<String>) -> Result<String, String> {
    let projects = crate::paths::projects_root()?;
    resolve_project_in(&projects, arguments, reported)
}

fn resolve_project_in(
    projects_root: &std::path::Path,
    arguments: &Value,
    reported: Option<String>,
) -> Result<String, String> {
    if arguments.get("project_id").is_some() {
        return Err("project_id is not accepted. Native tools use the open project".into());
    }
    let root = projects_root
        .canonicalize()
        .map_err(|e| format!("could not resolve the projects directory: {e}"))?;
    let project_id = reported
        .filter(|project| !project.is_empty())
        .ok_or_else(|| "no project is open in Oleafly".to_string())?;
    crate::paths::validate_project_id(&project_id)?;
    validate_open_project(&root, &project_id)?;
    Ok(project_id)
}

fn validate_open_project(root: &std::path::Path, project_id: &str) -> Result<(), String> {
    let candidate = root.join(project_id);
    let metadata = std::fs::symlink_metadata(&candidate)
        .map_err(|_| "the open project is no longer available".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("the open project is not a real directory".into());
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|_| "the open project is no longer available".to_string())?;
    if resolved.parent() != Some(root) {
        return Err("the open project escapes the project library".into());
    }
    let metadata = std::fs::symlink_metadata(resolved.join("project.json"))
        .map_err(|_| "the open project metadata is no longer available".to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("the open project metadata is not a real file".into());
    }
    Ok(())
}

fn required<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arg(arguments, key).ok_or_else(|| format!("missing required argument: {key}"))
}

fn required_nonempty<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    let value = required(arguments, key)?;
    if value.is_empty() {
        return Err(format!("{key} must not be empty"));
    }
    Ok(value)
}

fn payload(value: Value) -> Value {
    json!({ "content": [{ "type": "text", "text": value.to_string() }] })
}

fn replacement_output_size(
    body_bytes: usize,
    find_bytes: usize,
    replace_bytes: usize,
    replacements: usize,
) -> Result<usize, String> {
    let removed = find_bytes
        .checked_mul(replacements)
        .ok_or_else(|| "replacement size overflow".to_string())?;
    let inserted = replace_bytes
        .checked_mul(replacements)
        .ok_or_else(|| "replacement size overflow".to_string())?;
    body_bytes
        .checked_sub(removed)
        .and_then(|remaining| remaining.checked_add(inserted))
        .ok_or_else(|| "replacement size overflow".to_string())
}

pub struct CallOutcome {
    pub result: Value,
    pub change: Option<Value>,
}

fn outcome(result: Value, change: Option<Value>) -> CallOutcome {
    CallOutcome { result, change }
}

struct TextPage {
    content: String,
    lines_returned: usize,
    total_lines: usize,
    truncated: bool,
}

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
        for ch in line.chars() {
            if chars == max_chars {
                char_truncated = true;
                break 'lines;
            }
            content.push(ch);
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

pub async fn call(project_id: &str, name: &str, arguments: &Value) -> Result<CallOutcome, String> {
    if !READ_ONLY.contains(&name) && !NATIVE_MUTATING.contains(&name) {
        return Err(format!(
            "{name} is not available without the Oleafly interface"
        ));
    }
    match name {
        "read_file" => read_file(project_id, arguments).map(|result| outcome(result, None)),
        "write_file" => {
            let result = write_file(project_id, arguments).await?;
            Ok(outcome(result, mutation_event(name, arguments, None)))
        }
        "replace_in_file" => {
            let (result, content) = replace_in_file(project_id, arguments).await?;
            Ok(outcome(
                result,
                mutation_event(name, arguments, Some(content)),
            ))
        }
        "create_file" => create_file(project_id, arguments)
            .map(|result| outcome(result, mutation_event(name, arguments, None))),
        "delete_file" => delete_file(project_id, arguments)
            .map(|result| outcome(result, mutation_event(name, arguments, None))),
        "rename_file" => rename_file(project_id, arguments)
            .map(|result| outcome(result, mutation_event(name, arguments, None))),
        "list_files" => list_files(project_id)
            .await
            .map(|result| outcome(result, None)),
        "search_project" => search_project(project_id, arguments)
            .await
            .map(|result| outcome(result, None)),
        other => Err(format!("{other} is not handled natively")),
    }
}

fn read_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let body = crate::project::read_file_limited(project_id, path, MAX_READ_FILE_BYTES)?;
    let offset = arguments
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .max(1);
    let offset = usize::try_from(offset).unwrap_or(usize::MAX);
    let take = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
        .and_then(|v| usize::try_from(v).ok())
        .unwrap_or(MAX_READ_LINES)
        .min(MAX_READ_LINES);
    let page = text_page(&body, offset, take, MAX_READ_CHARS);
    Ok(payload(json!({
        "path": path,
        "offset": offset,
        "lines_returned": page.lines_returned,
        "total_lines": page.total_lines,
        "truncated": page.truncated,
        "content": page.content,
    })))
}

async fn write_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let content = required(arguments, "content")?;
    if content.len() > MAX_MUTATED_FILE_BYTES {
        return Err(format!(
            "content exceeds the {MAX_MUTATED_FILE_BYTES}-byte write limit"
        ));
    }
    crate::project::write_file(
        project_id.to_string(),
        path.to_string(),
        content.to_string(),
        None,
    )
    .await?;
    Ok(payload(
        json!({ "success": true, "path": path, "bytes": content.len() }),
    ))
}

async fn replace_in_file(project_id: &str, arguments: &Value) -> Result<(Value, String), String> {
    let path = required(arguments, "path")?;
    let find = required_nonempty(arguments, "find")?;
    let replace = required(arguments, "replace")?;
    let all = arguments
        .get("replace_all")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let body = crate::project::read_file_limited(project_id, path, MAX_READ_FILE_BYTES)?;
    let replacements = replacement_count(&body, find, all, path)?;
    validate_replacement_size(&body, find, replace, replacements)?;
    let updated = if all {
        body.replace(find, replace)
    } else {
        body.replacen(find, replace, 1)
    };
    crate::project::write_file(
        project_id.to_string(),
        path.to_string(),
        updated.clone(),
        None,
    )
    .await?;
    Ok((
        payload(json!({ "success": true, "path": path, "replacements": replacements })),
        updated,
    ))
}

fn replacement_count(body: &str, find: &str, all: bool, path: &str) -> Result<usize, String> {
    let occurrences = body.matches(find).count();
    if occurrences == 0 {
        return Err(format!("no match for the search text in {path}"));
    }
    Ok(if all { occurrences } else { 1 })
}

fn validate_replacement_size(
    body: &str,
    find: &str,
    replace: &str,
    replacements: usize,
) -> Result<(), String> {
    let output_bytes =
        replacement_output_size(body.len(), find.len(), replace.len(), replacements)?;
    if output_bytes > MAX_MUTATED_FILE_BYTES {
        return Err(format!(
            "replacement would exceed the {MAX_MUTATED_FILE_BYTES}-byte write limit"
        ));
    }
    Ok(())
}

fn mutation_event(name: &str, arguments: &Value, content: Option<String>) -> Option<Value> {
    match name {
        "write_file" | "replace_in_file" => {
            let content = content.or_else(|| arg(arguments, "content").map(str::to_string))?;
            Some(json!({
                "kind": "write",
                "path": arg(arguments, "path")?,
                "content": content,
            }))
        }
        "create_file" => Some(json!({
            "kind": "create",
            "path": arg(arguments, "path")?,
        })),
        "delete_file" => Some(json!({
            "kind": "delete",
            "path": arg(arguments, "path")?,
        })),
        "rename_file" => Some(json!({
            "kind": "rename",
            "from": arg(arguments, "from")?,
            "to": arg(arguments, "to")?,
        })),
        _ => None,
    }
}

fn create_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    let is_dir = arguments
        .get("is_dir")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    crate::project::create_file(project_id.to_string(), path.to_string(), is_dir, None)?;
    Ok(payload(
        json!({ "success": true, "path": path, "is_dir": is_dir }),
    ))
}

fn delete_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let path = required(arguments, "path")?;
    crate::project::delete_file(project_id.to_string(), path.to_string(), None)?;
    Ok(payload(json!({ "success": true, "path": path })))
}

fn rename_file(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let from = required(arguments, "from")?;
    let to = required(arguments, "to")?;
    let result = crate::project::rename_file_blocking(
        project_id.to_string(),
        from.to_string(),
        to.to_string(),
        None,
        None,
    )?;
    rename_result(from, result)
}

fn rename_result(from: &str, result: crate::project::RenameFileResult) -> Result<Value, String> {
    match result {
        crate::project::RenameFileResult::Renamed { path, .. } => Ok(payload(
            json!({ "success": true, "from": from, "to": path }),
        )),
        crate::project::RenameFileResult::Conflict {
            destination,
            suggested_destination,
            ..
        } => Err(format!(
            "a file or folder already exists at {destination}. Try {suggested_destination}"
        )),
    }
}

async fn list_files(project_id: &str) -> Result<Value, String> {
    let listing = crate::project::list_files_bounded(project_id.to_string()).await?;
    let files: Vec<Value> = listing
        .entries
        .iter()
        .map(|e| json!({ "path": e.path, "is_dir": e.is_dir }))
        .collect();
    Ok(payload(json!({
        "files": files,
        "scanned_entries": listing.scanned_entries,
        "truncated": listing.truncated,
    })))
}

async fn search_project(project_id: &str, arguments: &Value) -> Result<Value, String> {
    let query = required(arguments, "query")?;
    if query.is_empty() {
        return Err("query must not be empty".into());
    }
    if query.len() > MAX_SEARCH_QUERY_BYTES {
        return Err(format!(
            "query exceeds the {MAX_SEARCH_QUERY_BYTES}-byte search limit"
        ));
    }
    let search =
        crate::project::search_project_bounded(project_id.to_string(), query.to_string()).await?;
    let total = search.hits.len();
    let results: Vec<Value> = search
        .hits
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
    Ok(payload(json!({
        "results": results,
        "total": total,
        "scanned_entries": search.scanned_entries,
        "scanned_files": search.scanned_files,
        "scanned_bytes": search.scanned_bytes,
        "truncated": search.truncated,
    })))
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
    fn native_mutations_follow_the_headless_approval_policy() {
        for name in [
            "write_file",
            "replace_in_file",
            "create_file",
            "rename_file",
        ] {
            assert!(!handles(name, "ask"), "{name} under ask");
            assert!(handles(name, "auto_writes"), "{name} under auto_writes");
            assert!(handles(name, "trust"), "{name} under trust");
        }
        assert!(!handles("delete_file", "auto_writes"));
        assert!(!handles("delete_file", "trust"));
    }

    #[tokio::test]
    async fn the_native_dispatch_entry_point_rejects_interface_only_mutations() {
        for name in [
            "set_main_doc",
            "insert_figure",
            "toggle_theme",
            "open_project",
            "update_todos",
            "remember_note",
            "forget_note",
        ] {
            let error = match call("unused", name, &json!({})).await {
                Ok(_) => panic!("{name} unexpectedly ran natively"),
                Err(error) => error,
            };
            assert!(error.contains("Oleafly interface"), "{name}: {error}");
        }
    }

    #[test]
    fn read_only_mode_can_reject_every_mutating_tool_server_side() {
        for name in MUTATING {
            assert!(is_mutating(name), "{name}");
        }
        for name in READ_ONLY {
            assert!(!is_mutating(name), "{name}");
        }
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

    fn project_root() -> std::path::PathBuf {
        tempfile::Builder::new()
            .prefix("oleafly-native-scope-")
            .tempdir()
            .unwrap()
            .keep()
    }

    #[test]
    fn an_explicit_project_argument_cannot_override_the_open_project() {
        let root = project_root();
        std::fs::create_dir(root.join("swift-violet-fox")).unwrap();
        let arguments = json!({ "project_id": "swift-violet-fox" });
        std::fs::create_dir(root.join("other-project")).unwrap();
        assert!(resolve_project_in(&root, &arguments, Some("other-project".into())).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_traversal_project_id_is_refused() {
        let root = project_root();
        let arguments = json!({ "project_id": "../../etc" });
        assert!(resolve_project_in(&root, &arguments, None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_open_project_is_used_when_the_call_names_none() {
        let root = project_root();
        let project = root.join("open-one");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), "{}").unwrap();
        assert_eq!(
            resolve_project_in(&root, &json!({}), Some("open-one".into())).unwrap(),
            "open-one"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn native_calls_require_a_reported_open_project() {
        let root = project_root();
        for project_id in ["older", "newer"] {
            let project = root.join(project_id);
            std::fs::create_dir(&project).unwrap();
            std::fs::write(project.join("project.json"), "{}").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(resolve_project_in(&root, &json!({}), Some(String::new())).is_err());
        assert!(resolve_project_in(&root, &json!({}), None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_reported_project_must_exist_and_is_never_created_implicitly() {
        let root = project_root();
        let missing = root.join("missing-project");
        let error =
            resolve_project_in(&root, &json!({}), Some("missing-project".into())).unwrap_err();
        assert!(error.contains("no longer available"));
        assert!(!missing.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_required_argument_is_named_in_the_error() {
        let err = required(&json!({}), "path").unwrap_err();
        assert!(err.contains("path"));
    }

    #[test]
    fn an_empty_replacement_search_is_rejected() {
        let err = required_nonempty(&json!({ "find": "" }), "find").unwrap_err();
        assert!(err.contains("must not be empty"));
    }

    #[test]
    fn replacement_growth_is_checked_before_allocating_the_output() {
        assert_eq!(replacement_output_size(12, 2, 4, 3).unwrap(), 18);
        assert!(
            replacement_output_size(MAX_MUTATED_FILE_BYTES, 1, 2, 1).unwrap()
                > MAX_MUTATED_FILE_BYTES
        );
        assert!(replacement_output_size(usize::MAX, 1, 2, 1).is_err());
    }

    #[test]
    fn file_pages_bound_output_without_collecting_every_line() {
        let page = text_page("one\ntwo\nthree", 2, 2, 5);

        assert_eq!(page.content, "two\nt");
        assert_eq!(page.lines_returned, 2);
        assert_eq!(page.total_lines, 3);
        assert!(page.truncated);

        let past_end = text_page("one\ntwo", usize::MAX, 10, 100);
        assert!(past_end.content.is_empty());
        assert_eq!(past_end.lines_returned, 0);
        assert!(!past_end.truncated);
    }

    #[test]
    fn mutation_events_describe_the_files_the_webview_must_reconcile() {
        assert_eq!(
            mutation_event(
                "write_file",
                &json!({ "path": "main.tex", "content": "body" }),
                None,
            )
            .unwrap(),
            json!({ "kind": "write", "path": "main.tex", "content": "body" })
        );
        assert_eq!(
            mutation_event(
                "rename_file",
                &json!({ "from": "old.tex", "to": "new.tex" }),
                None,
            )
            .unwrap(),
            json!({ "kind": "rename", "from": "old.tex", "to": "new.tex" })
        );
        assert!(mutation_event("read_file", &json!({ "path": "main.tex" }), None).is_none());
    }

    #[test]
    fn a_rename_collision_is_not_reported_as_a_successful_move() {
        let error = rename_result(
            "draft.tex",
            crate::project::RenameFileResult::Conflict {
                destination: "final.tex".into(),
                suggested_destination: "final 2.tex".into(),
                generation: 0,
            },
        )
        .unwrap_err();

        assert!(error.contains("final.tex"));
        assert!(error.contains("final 2.tex"));
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
