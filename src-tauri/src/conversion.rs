//! The executable half of the conversion registry.
//!
//! `packages/conversion-registry` (TypeScript) is the declarative source of
//! truth the Import/Export menus and `docs/conversion-matrix.md` are generated
//! from. This module mirrors the routes that execute through pandoc so the
//! backend owns its own arg construction (and can test it) instead of trusting
//! flags sent from the webview. The two tables are kept in sync by
//! `conversion_routes_cover_the_registry_matrix` below.

/// Everything needed to turn one imported file into a new project.
pub(crate) struct ImportPlan {
    /// Name the source bytes are staged under inside the import directory.
    pub source_name: &'static str,
    /// Full pandoc argv (from/to flags, `-o main.<ext>`, source).
    pub args: Vec<String>,
    /// Main document written into project.json.
    pub main_doc: &'static str,
    /// Engine id written into project.json ("xetex", "typst", "markdown").
    pub engine: &'static str,
}

/// The pandoc reader name for an importable file extension.
fn pandoc_reader(extension: &str) -> Option<&'static str> {
    match extension {
        "docx" => Some("docx"),
        "md" | "markdown" => Some("markdown"),
        "html" | "htm" => Some("html"),
        "typ" => Some("typst"),
        _ => None,
    }
}

/// The pandoc writer + project engine for an import target. `latex` and
/// `markdown` name project kinds here, matching the Import dialog wording.
fn import_writer(target: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match target {
        "latex" => Some(("latex", "main.tex", "xetex")),
        "markdown" => Some(("markdown", "main.md", "markdown")),
        "typst" => Some(("typst", "main.typ", "typst")),
        _ => None,
    }
}

/// Build the pandoc invocation that turns `extension` into a project of
/// `target`. `None` means the pair is not a supported import route.
pub(crate) fn import_plan(extension: &str, target: &str) -> Option<ImportPlan> {
    let reader = pandoc_reader(extension)?;
    let (writer, main_doc, engine) = import_writer(target)?;
    // Reading a format into its own project kind is a copy, not a conversion.
    if reader == writer {
        return None;
    }
    let mut args = vec![
        format!("--from={reader}"),
        format!("--to={writer}"),
        "--standalone".into(),
    ];
    if extension == "docx" || extension == "html" || extension == "htm" {
        args.push("--extract-media=assets".into());
    }
    args.extend(["-o".into(), main_doc.to_string()]);
    args.extend(["--".into(), source_name_for(extension).to_string()]);
    Some(ImportPlan {
        source_name: source_name_for(extension),
        args,
        main_doc,
        engine,
    })
}

fn source_name_for(extension: &str) -> &'static str {
    match extension {
        "docx" => "source.docx",
        "md" | "markdown" => "source.md",
        "html" | "htm" => "source.html",
        "typ" => "source.typ",
        _ => "source.bin",
    }
}

/// The pandoc writer and destination extension for an export format id.
/// Mirrors the TS registry's export routes; `None` is not an export format.
pub(crate) fn export_writer(format: &str) -> Option<(&'static str, &'static str)> {
    match format {
        "docx" => Some(("docx", "docx")),
        "html" => Some(("html5", "html")),
        "md" => Some(("markdown", "md")),
        "txt" => Some(("plain", "txt")),
        "pptx" => Some(("pptx", "pptx")),
        "epub" => Some(("epub", "epub")),
        "typst" => Some(("typst", "typ")),
        "tex" => Some(("latex", "tex")),
        _ => None,
    }
}

/// Whether an export format needs `--standalone` to produce a usable file.
/// Typst and LaTeX writers emit fragments without it.
pub(crate) fn export_needs_standalone(format: &str) -> bool {
    matches!(format, "typst" | "tex")
}

/// Pandoc's Typst writer emits `font: (),`, which current Typst rejects.
/// Substitute a real font stack until upstream stops emitting the empty list.
pub(crate) fn fixup_typst_source(source: &str) -> String {
    source.replace("font: (),", "font: (\"New Computer Modern\",),")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docx_to_latex_keeps_the_historical_flags() {
        let plan = import_plan("docx", "latex").unwrap();
        assert_eq!(plan.source_name, "source.docx");
        assert_eq!(plan.main_doc, "main.tex");
        assert_eq!(plan.engine, "xetex");
        assert!(plan.args.contains(&"--extract-media=assets".to_string()));
        assert!(plan.args.contains(&"--from=docx".to_string()));
        assert!(plan.args.contains(&"--to=latex".to_string()));
    }

    #[test]
    fn every_reader_pairs_with_every_foreign_writer() {
        let extensions = ["docx", "md", "html", "typ"];
        let targets = ["latex", "markdown", "typst"];
        for ext in &extensions {
            for target in &targets {
                let plan = import_plan(ext, target);
                let reader = pandoc_reader(ext).unwrap();
                let (writer, _, _) = import_writer(target).unwrap();
                if reader == writer {
                    assert!(plan.is_none(), "{ext} -> {target} should be identity");
                } else {
                    let plan = plan.unwrap_or_else(|| panic!("{ext} -> {target} missing"));
                    assert!(plan.main_doc.ends_with(writer_ext(writer)));
                }
            }
        }
    }

    fn writer_ext(writer: &str) -> &'static str {
        match writer {
            "latex" => "tex",
            "markdown" => "md",
            "typst" => "typ",
            _ => "docx",
        }
    }

    #[test]
    fn identity_routes_are_rejected() {
        assert!(import_plan("md", "markdown").is_none());
        assert!(import_plan("typ", "typst").is_none());
        assert!(import_plan("docx", "latex").is_some());
    }

    #[test]
    fn unknown_extensions_and_targets_are_rejected() {
        assert!(import_plan("pdf", "latex").is_none());
        assert!(import_plan("docx", "docx").is_none());
        assert!(import_plan("html", "bibtex").is_none());
    }

    #[test]
    fn typst_fixup_replaces_the_empty_font_list() {
        let source = "// Document setup\n#set text(font: (),)\n= Title\n";
        let fixed = fixup_typst_source(source);
        assert!(fixed.contains("font: (\"New Computer Modern\",),"));
        assert!(!fixed.contains("font: (),"));
        // Idempotent.
        assert_eq!(fixed, fixup_typst_source(&fixed));
    }

    #[test]
    fn conversion_routes_cover_the_registry_matrix() {
        // Every (extension, target) pair the TS registry advertises as a
        // pandoc import must resolve to a plan, and vice versa. The registry
        // cells: docx/md/html/typ in, latex/markdown/typst projects out.
        let expected: &[(&str, &str)] = &[
            ("docx", "latex"),
            ("docx", "markdown"),
            ("docx", "typst"),
            ("md", "latex"),
            ("md", "typst"),
            ("html", "latex"),
            ("html", "markdown"),
            ("html", "typst"),
            ("typ", "latex"),
            ("typ", "markdown"),
        ];
        for (ext, target) in expected {
            assert!(
                import_plan(ext, target).is_some(),
                "registry route {ext} -> {target} has no backend plan"
            );
        }
        // Writers for every export format the registry knows.
        for format in ["docx", "html", "md", "txt", "pptx", "epub", "typst", "tex"] {
            assert!(export_writer(format).is_some(), "no writer for {format}");
        }
        assert!(export_writer("bibtex").is_none());
    }
}
