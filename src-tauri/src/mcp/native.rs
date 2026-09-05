use serde_json::{json, Value};

const MAX_SEARCH_RESULTS: usize = 20;
const MAX_SEARCH_QUERY_BYTES: usize = 1_024;
const MAX_READ_LINES: usize = 800;
const MAX_READ_CHARS: usize = 40_000;
const MAX_READ_FILE_BYTES: usize = 16 * 1024 * 1024;
const SKILL_TOOLS: &[&str] = &["list_skills", "load_skill", "read_skill_file"];
const READ_ONLY: &[&str] = &[
    "read_file",
    "list_files",
    "search_project",
    "list_skills",
    "load_skill",
    "read_skill_file",
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
    "run_command",
    "computer_use",
];

pub fn is_mutating(name: &str) -> bool {
    MUTATING.contains(&name)
}

pub fn handles(name: &str, _approval_policy: &str) -> bool {
    READ_ONLY.contains(&name)
}

pub fn handles_for_agent(name: &str) -> bool {
    READ_ONLY.contains(&name) && !SKILL_TOOLS.contains(&name)
}

pub fn needs_project(name: &str) -> bool {
    !SKILL_TOOLS.contains(&name)
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

fn payload(value: Value) -> Value {
    json!({ "content": [{ "type": "text", "text": value.to_string() }] })
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
    if !READ_ONLY.contains(&name) {
        return Err(format!(
            "{name} is not available without the Oleafly interface"
        ));
    }
    match name {
        "list_skills" => list_skills().map(|result| outcome(result, None)),
        "load_skill" => load_skill(arguments).map(|result| outcome(result, None)),
        "read_skill_file" => read_skill_file(arguments).map(|result| outcome(result, None)),
        "read_file" => read_file(project_id, arguments).map(|result| outcome(result, None)),
        "list_files" => list_files(project_id)
            .await
            .map(|result| outcome(result, None)),
        "search_project" => search_project(project_id, arguments)
            .await
            .map(|result| outcome(result, None)),
        other => Err(format!("{other} is not handled natively")),
    }
}

fn skill_records() -> Result<Vec<crate::skills::SkillRecord>, String> {
    let root = crate::paths::oleafly_root()?;
    let pack_root = crate::skills_pack::cached_pack_root();
    crate::skills::list_with(&root, pack_root.as_deref(), None)
}

fn valid_skill(record: &crate::skills::SkillRecord) -> bool {
    matches!(record.validation, crate::skills::SkillValidation::Valid)
}

fn list_skills() -> Result<Value, String> {
    let skills: Vec<Value> = skill_records()?
        .into_iter()
        .filter(valid_skill)
        .map(|record| {
            json!({
                "id": record.id,
                "name": record.name,
                "description": record.description,
                "phase": record.phase,
                "tier": record.tier,
                "enabled": record.enabled,
            })
        })
        .collect();
    Ok(payload(json!({ "skills": skills })))
}

fn load_skill(arguments: &Value) -> Result<Value, String> {
    let id = required(arguments, "id")?;
    let record = skill_records()?
        .into_iter()
        .filter(valid_skill)
        .find(|record| record.id == id)
        .ok_or_else(|| format!("no skill named {id} is installed"))?;
    let files: Vec<Value> = record
        .files
        .iter()
        .map(|file| json!({ "path": file.path, "bytes": file.bytes }))
        .collect();
    Ok(payload(json!({
        "id": record.id,
        "name": record.name,
        "description": record.description,
        "dir": record.dir,
        "files": files,
        "instructions": record.instructions,
    })))
}

fn read_skill_file(arguments: &Value) -> Result<Value, String> {
    let id = required(arguments, "id")?;
    let path = required(arguments, "path")?;
    let root = crate::paths::oleafly_root()?;
    let file = crate::skills::read_skill_file(&root, id, path)?;
    Ok(payload(json!({
        "path": file.path,
        "content": file.content,
        "truncated": file.truncated,
    })))
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
    fn skill_reads_run_natively_without_an_open_project() {
        for policy in ["ask", "auto_writes", "trust"] {
            for name in SKILL_TOOLS {
                assert!(handles(name, policy), "{name} under {policy}");
                assert!(!is_mutating(name), "{name}");
                assert!(!needs_project(name), "{name}");
            }
        }
        for name in ["read_file", "list_files", "search_project"] {
            assert!(needs_project(name), "{name}");
        }
    }

    #[test]
    fn the_agent_keeps_skill_tools_in_the_webview() {
        for name in SKILL_TOOLS {
            assert!(!handles_for_agent(name), "{name}");
        }
        for name in ["read_file", "list_files", "search_project"] {
            assert!(handles_for_agent(name), "{name}");
        }
        assert!(!handles_for_agent("write_file"));
    }

    #[test]
    fn native_mutations_always_require_a_renderer() {
        for name in [
            "write_file",
            "replace_in_file",
            "create_file",
            "rename_file",
        ] {
            assert!(!handles(name, "ask"), "{name} under ask");
            assert!(!handles(name, "auto_writes"), "{name} under auto_writes");
            assert!(!handles(name, "trust"), "{name} under trust");
        }
        assert!(!handles("delete_file", "auto_writes"));
        assert!(!handles("delete_file", "trust"));
    }

    #[tokio::test]
    async fn the_native_dispatch_entry_point_rejects_interface_only_mutations() {
        for name in [
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
            "run_command",
            "computer_use",
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
        for name in ["run_command", "computer_use"] {
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
    fn results_carry_a_json_document_in_the_mcp_text_block() {
        let value = payload(json!({ "path": "main.tex", "content": "body" }));
        assert_eq!(value["content"][0]["type"], "text");

        let inner: Value =
            serde_json::from_str(value["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(inner["path"], "main.tex");
        assert_eq!(inner["content"], "body");
    }
}
