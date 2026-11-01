use std::sync::Arc;

use serde_json::{json, Value};

use super::{schema, ToolContext, ToolSpec};
use crate::agent::policy::Allow;
use crate::agent::workspace::READ_WINDOW_BYTES;

pub(super) fn specs() -> Vec<ToolSpec> {
    let path = json!({"type": "string", "maxLength": 1024, "description": "A path relative to the project folder."});
    vec![
        ToolSpec {
            name: "list_files",
            needs: Allow::Read,
            writes: false,
            schema: schema(
                "list_files",
                "List the files and folders under a folder of the project. Folders end with a slash.",
                json!({
                    "path": {"type": "string", "maxLength": 1024, "description": "A folder relative to the project. Leave it out for the whole project."},
                    "max_depth": {"type": "integer", "minimum": 1, "maximum": 5, "description": "How many levels to list (default 2)."},
                }),
                &[],
            ),
        },
        ToolSpec {
            name: "read_file",
            needs: Allow::Read,
            writes: false,
            schema: schema(
                "read_file",
                "Read a text file of the project. Long files come in windows: call again with nextOffset to read on.",
                json!({
                    "path": path,
                    "offset": {"type": "integer", "minimum": 0, "description": "Where to start (a nextOffset from an earlier read)."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": READ_WINDOW_BYTES, "description": "How many bytes to read."},
                }),
                &["path"],
            ),
        },
        ToolSpec {
            name: "search_project",
            needs: Allow::Read,
            writes: false,
            schema: schema(
                "search_project",
                "Find the lines of the project's text files that contain a phrase (or match a regular expression). Returns at most 200 matches.",
                json!({
                    "query": {"type": "string", "minLength": 1, "maxLength": 1024},
                    "regex": {"type": "boolean", "description": "Treat the query as a regular expression."},
                    "path": {"type": "string", "maxLength": 1024, "description": "Search only under this folder."},
                }),
                &["query"],
            ),
        },
        ToolSpec {
            name: "write_file",
            needs: Allow::Write,
            writes: true,
            schema: schema(
                "write_file",
                "Write a whole text file, creating it and its folders when missing.",
                json!({"path": path, "content": {"type": "string"}}),
                &["path", "content"],
            ),
        },
        ToolSpec {
            name: "edit_file",
            needs: Allow::Write,
            writes: true,
            schema: schema(
                "edit_file",
                "Replace a piece of text in a file. The old text must appear exactly once unless replace_all is set.",
                json!({
                    "path": path,
                    "old": {"type": "string", "minLength": 1},
                    "new": {"type": "string"},
                    "replace_all": {"type": "boolean"},
                }),
                &["path", "old", "new"],
            ),
        },
        ToolSpec {
            name: "delete_file",
            needs: Allow::Write,
            writes: true,
            schema: schema("delete_file", "Delete a file of the project.", json!({"path": path}), &["path"]),
        },
    ]
}

fn text<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arguments[key]
        .as_str()
        .ok_or_else(|| format!("Give {key} as text."))
}

fn optional_text<'a>(arguments: &'a Value, key: &str) -> &'a str {
    arguments[key].as_str().unwrap_or("")
}

fn number(arguments: &Value, key: &str, default: usize) -> usize {
    arguments[key].as_u64().map_or(default, |value| {
        usize::try_from(value).unwrap_or(usize::MAX)
    })
}

fn run(ctx: &ToolContext, name: &str, arguments: &Value) -> Result<Value, String> {
    let workspace = &ctx.workspace;
    let result = match name {
        "list_files" => workspace.list(
            optional_text(arguments, "path"),
            number(arguments, "max_depth", 2),
        ),
        "read_file" => workspace.read_text(
            text(arguments, "path")?,
            number(arguments, "offset", 0),
            number(arguments, "limit", READ_WINDOW_BYTES),
        ),
        "search_project" => workspace.search(
            text(arguments, "query")?,
            arguments["regex"].as_bool().unwrap_or(false),
            optional_text(arguments, "path"),
        ),
        "write_file" => workspace.write_text(text(arguments, "path")?, text(arguments, "content")?),
        "edit_file" => workspace.edit_text(
            text(arguments, "path")?,
            text(arguments, "old")?,
            text(arguments, "new")?,
            arguments["replace_all"].as_bool().unwrap_or(false),
        ),
        "delete_file" => workspace.delete(text(arguments, "path")?),
        _ => return Err(format!("The tool {name} is not available in this run.")),
    };
    result.map_err(|error| error.to_string())
}

pub(super) async fn call(
    ctx: Arc<ToolContext>,
    name: String,
    arguments: Value,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || run(&ctx, &name, &arguments))
        .await
        .map_err(|_| "The tool stopped before it returned a result.".to_string())?
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::test_support::{context, policy};
    use super::*;
    use crate::agent::policy::{AllowSet, WriteMode};

    #[tokio::test]
    async fn files_are_read_written_edited_and_deleted_through_the_guard() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.tex"), "Hello world").unwrap();
        let ctx = context(
            project.path(),
            policy(
                WriteMode::Apply,
                AllowSet {
                    write: true,
                    ..AllowSet::default()
                },
                false,
            ),
        );
        let read = call(ctx.clone(), "read_file".into(), json!({"path": "main.tex"}))
            .await
            .unwrap();
        assert_eq!(read["content"], "Hello world");
        call(
            ctx.clone(),
            "write_file".into(),
            json!({"path": "notes/a.md", "content": "a"}),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(project.path().join("notes/a.md")).unwrap(),
            "a"
        );
        call(
            ctx.clone(),
            "edit_file".into(),
            json!({"path": "main.tex", "old": "world", "new": "there"}),
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(project.path().join("main.tex")).unwrap(),
            "Hello there"
        );
        let found = call(
            ctx.clone(),
            "search_project".into(),
            json!({"query": "there"}),
        )
        .await
        .unwrap();
        assert_eq!(found["matches"][0]["path"], "main.tex");
        call(
            ctx.clone(),
            "delete_file".into(),
            json!({"path": "notes/a.md"}),
        )
        .await
        .unwrap();
        assert!(!project.path().join("notes/a.md").exists());
        let escape = call(
            ctx.clone(),
            "read_file".into(),
            json!({"path": "../outside"}),
        )
        .await
        .unwrap_err();
        assert!(!escape.is_empty());
        let missing = call(ctx, "write_file".into(), json!({"path": "x"}))
            .await
            .unwrap_err();
        assert!(missing.contains("content"));
    }
}
