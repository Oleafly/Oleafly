//! `preflight_check` and `lint_sources` for `oleafly mcp`: the `check` and
//! `lint` reports as tool results. Both only read; `lint_sources` never
//! fixes.
use serde_json::{json, Value};

use super::{execute, CheckArg, CheckInput};
use crate::lint::{execute_lint, DialectArg, LintInput};
use crate::mcp::tools::{object, tool, BoxFuture, McpToolSet, ToolContext, ToolError, READ};
use crate::mcp::ToolMeta;

pub struct CheckTools;

fn check_arg(name: &str) -> Result<CheckArg, ToolError> {
    Ok(match name {
        "compile" => CheckArg::Compile,
        "submission" => CheckArg::Submission,
        "ats" => CheckArg::Ats,
        "a11y" => CheckArg::A11y,
        "refs" => CheckArg::Refs,
        "privacy" => CheckArg::Privacy,
        "all" => CheckArg::All,
        other => {
            return Err(ToolError(format!(
                "{other} isn't a check. Use compile, submission, ats, a11y, refs, privacy or all."
            )))
        }
    })
}

fn dialect_arg(name: &str) -> Result<DialectArg, ToolError> {
    Ok(match name {
        "american" => DialectArg::American,
        "british" => DialectArg::British,
        "australian" => DialectArg::Australian,
        "canadian" => DialectArg::Canadian,
        "indian" => DialectArg::Indian,
        other => {
            return Err(ToolError(format!(
                "{other} isn't a dialect. Use american, british, australian, canadian or indian."
            )))
        }
    })
}

fn strings(args: &Value, key: &str) -> Result<Vec<String>, ToolError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| ToolError(format!("{key} must be a list of strings.")))
            })
            .collect(),
        Some(_) => Err(ToolError(format!("{key} must be a list of strings."))),
    }
}

async fn preflight_check(args: &Value, ctx: &ToolContext) -> Result<Value, ToolError> {
    let opened = crate::engine::open_project(&ctx.root, None, None)?;
    let workspace = &opened.workspace;
    let manifest = workspace.manifest();
    let profile = match args.get("profile").and_then(Value::as_str) {
        Some(name) => Some(
            oleafly_preflight::SubmissionProfileId::parse(name).ok_or_else(|| {
                ToolError(format!(
                    "{name} isn't a profile. Use generic, arxiv, ieee, acm, journal or thesis."
                ))
            })?,
        ),
        None => None,
    };
    let checks = strings(args, "checks")?
        .iter()
        .map(|name| check_arg(name))
        .collect::<Result<Vec<_>, _>>()?;
    let input = CheckInput {
        root: workspace.root().to_path_buf(),
        main_document: manifest.main_doc.clone(),
        engine: manifest.engine().map_err(crate::contract::CliError::from)?,
        tex_flavor: manifest.normalized_tex_flavor().ok().flatten(),
        typst_version: manifest.typst_version_pin().map(str::to_string),
        build_dir: workspace.build_dir_path(),
        profile,
        anonymous: args
            .get("anonymous")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        checks,
        build_log: None,
        pdf: None,
        no_build_output: false,
    };
    let run = tokio::task::spawn_blocking(move || execute(input))
        .await
        .map_err(|error| ToolError(error.to_string()))??;
    Ok(run.payload)
}

async fn lint_sources(args: &Value, ctx: &ToolContext) -> Result<Value, ToolError> {
    let opened = crate::engine::open_project(&ctx.root, None, None)?;
    let root = opened.workspace.root().to_path_buf();
    let mut paths = Vec::new();
    for path in strings(args, "paths")? {
        if path.chars().any(char::is_control)
            || path.contains('\\')
            || std::path::Path::new(&path).is_absolute()
        {
            return Err(ToolError(format!(
                "{path} isn't a path inside the project."
            )));
        }
        oleafly_core::resolve_project_path(&root, &path)
            .map_err(|_| ToolError(format!("{path} isn't a path inside the project.")))?;
        paths.push(root.join(&path));
    }
    let dialect = match args.get("dialect").and_then(Value::as_str) {
        Some(name) => dialect_arg(name)?,
        None => DialectArg::American,
    };
    let input = LintInput {
        cwd: root.clone(),
        root,
        paths,
        fix: false,
        prose: args.get("prose").and_then(Value::as_bool).unwrap_or(true),
        dialect,
        words: String::new(),
    };
    let run = tokio::task::spawn_blocking(move || execute_lint(input))
        .await
        .map_err(|error| ToolError(error.to_string()))??;
    Ok(run.payload)
}

impl McpToolSet for CheckTools {
    fn tools(&self) -> Vec<ToolMeta> {
        vec![
            tool(
                "preflight_check",
                "Preflight check",
                "Run the preflight checks on this project (build log, submission, accessibility, references, privacy) and return the findings as JSON.",
                json!({
                    "profile": {"type": "string", "enum": ["generic", "arxiv", "ieee", "acm", "journal", "thesis"]},
                    "anonymous": {"type": "boolean"},
                    "checks": {"type": "array", "items": {"type": "string", "enum": ["compile", "submission", "ats", "a11y", "refs", "privacy", "all"]}},
                }),
                &[],
                object(&["findings", "summary"], json!({"findings": {"type": "array"}, "summary": {"type": "object"}})),
                READ,
            ),
            tool(
                "lint_sources",
                "Lint sources",
                "Lint LaTeX, BibTeX, spelling and grammar in this project and return the findings as JSON. Never changes files.",
                json!({
                    "paths": {"type": "array", "items": {"type": "string"}},
                    "prose": {"type": "boolean"},
                    "dialect": {"type": "string", "enum": ["american", "british", "australian", "canadian", "indian"]},
                }),
                &[],
                object(&["findings", "summary"], json!({"findings": {"type": "array"}, "summary": {"type": "object"}})),
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
            "preflight_check" => Box::pin(preflight_check(args, ctx)),
            "lint_sources" => Box::pin(lint_sources(args, ctx)),
            _ => return None,
        };
        Some(future)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(root: &std::path::Path) -> ToolContext {
        ToolContext {
            root: root.to_path_buf(),
            data_root: None,
            build_timeout: std::time::Duration::from_secs(30),
            limits: Default::default(),
        }
    }

    #[test]
    fn check_tools_are_read_only_and_described() {
        let tools = CheckTools.tools();
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            ["preflight_check", "lint_sources"]
        );
        for tool in tools {
            let hints = tool.annotations.unwrap();
            assert_eq!(
                (
                    hints.read_only_hint,
                    hints.open_world_hint,
                    hints.idempotent_hint
                ),
                (Some(true), Some(false), Some(true))
            );
            assert_eq!(tool.input_schema["type"], "object");
        }
    }

    #[tokio::test]
    async fn preflight_check_tool_returns_the_cli_payload() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nHi \\cite{nope}.\n\\end{document}\n",
        )
        .unwrap();
        let value = CheckTools
            .call(
                "preflight_check",
                &json!({"checks": ["refs"]}),
                &context(project.path()),
            )
            .unwrap()
            .await
            .unwrap();
        for key in ["findings", "summary", "scores", "coverage", "profile"] {
            assert!(value.get(key).is_some(), "{key}");
        }
        let error = CheckTools
            .call(
                "lint_sources",
                &json!({"paths": ["../x.tex"]}),
                &context(project.path()),
            )
            .unwrap()
            .await
            .unwrap_err();
        assert!(error.0.contains("isn't a path inside the project"));
    }
}
