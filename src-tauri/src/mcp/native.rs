use serde_json::{json, Value};

const MAX_SEARCH_HITS: usize = 200;
const MAX_READ_LINES: usize = 4000;

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

fn text(value: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": value.into() }] })
}

pub async fn call(project_id: &str, name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        "read_file" => {
            let path = required(arguments, "path")?;
            let body = crate::project::read_file(project_id.to_string(), path.to_string())?;
            let offset = arguments
                .get("offset")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .max(1) as usize;
            let limit = arguments
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(MAX_READ_LINES)
                .min(MAX_READ_LINES);
            let lines: Vec<&str> = body.lines().skip(offset - 1).take(limit).collect();
            Ok(text(lines.join("\n")))
        }
        "write_file" => {
            let path = required(arguments, "path")?;
            let content = required(arguments, "content")?;
            crate::project::write_file(
                project_id.to_string(),
                path.to_string(),
                content.to_string(),
            )
            .await?;
            Ok(text(format!("wrote {path}")))
        }
        "replace_in_file" => {
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
            Ok(text(format!(
                "replaced {replacements} occurrence(s) in {path}"
            )))
        }
        "create_file" => {
            let path = required(arguments, "path")?;
            let is_dir = arguments
                .get("is_dir")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            crate::project::create_file(project_id.to_string(), path.to_string(), is_dir)?;
            Ok(text(format!("created {path}")))
        }
        "delete_file" => {
            let path = required(arguments, "path")?;
            crate::project::delete_file(project_id.to_string(), path.to_string())?;
            Ok(text(format!("deleted {path}")))
        }
        "rename_file" => {
            let from = required(arguments, "from")?;
            let to = required(arguments, "to")?;
            crate::project::rename_file(
                project_id.to_string(),
                from.to_string(),
                to.to_string(),
                None,
            )?;
            Ok(text(format!("renamed {from} to {to}")))
        }
        "list_files" => {
            let entries = crate::project::list_files(project_id.to_string()).await?;
            let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
            Ok(text(paths.join("\n")))
        }
        "search_project" => {
            let query = required(arguments, "query")?;
            if query.is_empty() {
                return Err("query must not be empty".into());
            }
            let entries = crate::project::list_files(project_id.to_string()).await?;
            let mut hits = Vec::new();
            for entry in entries {
                if entry.is_dir {
                    continue;
                }
                let Ok(body) =
                    crate::project::read_file(project_id.to_string(), entry.path.clone())
                else {
                    continue;
                };
                for (index, line) in body.lines().enumerate() {
                    if line.contains(query) {
                        hits.push(format!("{}:{}: {}", entry.path, index + 1, line.trim()));
                        if hits.len() >= MAX_SEARCH_HITS {
                            break;
                        }
                    }
                }
                if hits.len() >= MAX_SEARCH_HITS {
                    break;
                }
            }
            Ok(text(if hits.is_empty() {
                "no matches".to_string()
            } else {
                hits.join("\n")
            }))
        }
        other => Err(format!("{other} is not handled natively")),
    }
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
        // Whatever the disk scan finds, an empty id must never be returned:
        // it would resolve to the projects root itself.
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
    fn text_results_use_the_mcp_content_shape() {
        let value = text("hello");
        assert_eq!(value["content"][0]["type"], "text");
        assert_eq!(value["content"][0]["text"], "hello");
    }
}
