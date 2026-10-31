use std::path::Path;
use std::sync::Arc;

use oleafly_core::context::{
    bounded_view, role_counts, scan_project, ContextLimits, VIEW_MAX_BYTES,
};
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
            "Read the project's structure: how many files of each role it has, sections, labels, citations, unused labels and citations, missing files and packages. Long lists are cut; truncatedCounts says how many items each one lost.",
            json!({}),
            &[],
        ),
    }]
}

pub(crate) fn context_of(root: &Path) -> Result<Value, String> {
    let opened = open_project(root, None, None).map_err(|_| NO_MAIN_DOCUMENT.to_string())?;
    let main = opened.workspace.manifest().main_doc.clone();
    if main.is_empty() {
        return Err(NO_MAIN_DOCUMENT.into());
    }
    let scan = scan_project(root, &main, &ContextLimits::default())
        .map_err(|error| error.message().to_string())?;
    let value = json!({
        "mainDocument": main,
        "map": scan.map,
        "roleCounts": role_counts(&scan.roles),
        "unusedCites": scan.unused_cites,
        "unusedLabels": scan.unused_labels,
        "missingFiles": scan.missing_files,
        "packages": scan.packages,
        "truncated": scan.truncated,
        "skipped": scan.skipped,
    });
    Ok(bounded_view(value, VIEW_MAX_BYTES, "truncatedCounts"))
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
    fn a_large_project_fits_a_tool_result() {
        let project = tempfile::tempdir().unwrap();
        let mut bib = String::new();
        for index in 0..3_000 {
            bib.push_str(&format!(
                "@misc{{reference-key-number-{index}, title={{T}}}}\n"
            ));
        }
        std::fs::write(project.path().join("refs.bib"), bib).unwrap();
        std::fs::create_dir_all(project.path().join("figures")).unwrap();
        for index in 0..2_000 {
            std::fs::write(project.path().join(format!("figures/plot-{index}.png")), "").unwrap();
        }
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\cite{ghost}\n\\bibliography{refs}\n\\end{document}\n",
        )
        .unwrap();
        let value = context_of(project.path()).unwrap();
        assert!(
            value.to_string().len() < 64 * 1024,
            "{}",
            value.to_string().len()
        );
        assert_eq!(value["roleCounts"]["figure"], 2_000);
        assert!(value.get("roles").is_none());
        assert_eq!(value["map"]["unresolvedCites"], json!(["ghost"]));
        let cut = &value["truncatedCounts"];
        assert!(cut["map.bibKeys"].as_u64().unwrap() > 0);
        assert!(cut["unusedCites"].as_u64().unwrap() > 0);
    }

    #[test]
    fn a_folder_without_a_main_document_says_so() {
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(context_of(empty.path()).unwrap_err(), NO_MAIN_DOCUMENT);
    }
}
