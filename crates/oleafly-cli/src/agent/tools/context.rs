//! `project_context`: the project's structure as Oleafly reads it (outline,
//! labels, citations, missing files, packages).
use std::path::Path;
use std::sync::Arc;

use oleafly_core::context::{scan_project, ContextLimits};
use serde_json::{json, Value};

use super::{schema, ToolContext, ToolSpec};
use crate::agent::policy::Allow;
use crate::engine::open_project;

const NO_MAIN_DOCUMENT: &str = "This folder has no main document Oleafly can find.";

pub(super) fn specs() -> Vec<ToolSpec> {
    vec![ToolSpec {
        name: "project_context",
        needs: Allow::Read,
        writes: false,
        schema: schema(
            "project_context",
            "Read the project's structure: its files and their roles, sections, labels, citations, unused labels and citations, missing files and packages.",
            json!({}),
            &[],
        ),
    }]
}

/// The scan of the project at `root`.
pub(crate) fn context_of(root: &Path) -> Result<Value, String> {
    let opened = open_project(root, None, None).map_err(|_| NO_MAIN_DOCUMENT.to_string())?;
    let main = opened.workspace.manifest().main_doc.clone();
    if main.is_empty() {
        return Err(NO_MAIN_DOCUMENT.into());
    }
    let scan = scan_project(root, &main, &ContextLimits::default())
        .map_err(|error| error.message().to_string())?;
    Ok(json!({
        "mainDocument": main,
        "map": scan.map,
        "roles": scan.roles,
        "unusedCites": scan.unused_cites,
        "unusedLabels": scan.unused_labels,
        "missingFiles": scan.missing_files,
        "packages": scan.packages,
        "truncated": scan.truncated,
    }))
}

pub(super) async fn project_context(ctx: Arc<ToolContext>) -> Result<Value, String> {
    let root = ctx.workspace.work_root().to_path_buf();
    tokio::task::spawn_blocking(move || context_of(&root))
        .await
        .map_err(|_| "The tool stopped before it returned a result.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_context_names_sections_labels_and_unused_citations() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{sec:a}\n\\end{document}\n",
        )
        .unwrap();
        let value = context_of(project.path()).unwrap();
        assert_eq!(value["mainDocument"], "main.tex");
        assert!(value["map"]["labels"].to_string().contains("sec:a"));
        assert!(value.get("unusedLabels").is_some() && value.get("missingFiles").is_some());
    }

    #[test]
    fn a_folder_without_a_main_document_says_so() {
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(context_of(empty.path()).unwrap_err(), NO_MAIN_DOCUMENT);
    }
}
