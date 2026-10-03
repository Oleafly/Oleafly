//! The executable half of the conversion registry.
//!
//! `packages/conversion-registry` (TypeScript) is the declarative source of
//! truth the Import/Export menus and `docs/conversion-matrix.md` are generated
//! from. This module mirrors the routes that execute through pandoc so the
//! backend owns its own arg construction (and can test it) instead of trusting
//! flags sent from the webview. The two tables are kept in sync by
//! `conversion_routes_cover_the_registry_matrix` below.

use std::path::{Path, PathBuf};

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

/// A whitelisted, project-independent pandoc conversion. The caller supplies
/// bytes for `source_name`; pandoc writes `output_name` inside an isolated
/// temporary directory. Keeping argv construction here means the webview can
/// choose a registered route, but cannot smuggle arbitrary pandoc flags.
pub(crate) struct AdHocPlan {
    pub source_name: &'static str,
    pub output_name: &'static str,
    pub args: Vec<String>,
    pub binary_output: bool,
    pub media_type: &'static str,
    /// Stage `export-references.lua` beside the source (rendered targets).
    pub references_filter: bool,
    /// Markdown or Typst into LaTeX or Typst: the output names the source's
    /// bibliography, so `add_bibliographies` points it at local file names.
    pub local_bibliography: bool,
}

impl AdHocPlan {
    /// Point `\bibliography` at `names` instead of the paths the source gave.
    pub fn add_bibliographies(&mut self, names: &[String]) {
        add_bibliography_args(&mut self.args, names);
    }
}

/// The argument that drops the source's own bibliography entry.
pub(crate) const NO_BIBLIOGRAPHY: &str = "--metadata=bibliography=false";

/// Adds `--bibliography=<name>` for each of `names` before the `--`
/// separator. With no names, the source's own bibliography entry is
/// dropped, so a path from the source machine is never written out.
fn add_bibliography_args(args: &mut Vec<String>, names: &[String]) {
    let separator = args
        .iter()
        .position(|argument| argument == "--")
        .unwrap_or(args.len());
    let extra: Vec<String> = if names.is_empty() {
        vec![NO_BIBLIOGRAPHY.into()]
    } else {
        names
            .iter()
            .map(|name| format!("--bibliography={name}"))
            .collect()
    };
    args.splice(separator..separator, extra);
}

/// LaTeX output from Markdown or Typst keeps citations as natbib commands
/// (`\citep`, `\citet`) and writes `\bibliography`. Without this pandoc
/// prints `[@key]` as literal text.
fn writes_natbib(reader: &str, writer: &str) -> bool {
    writer == "latex" && matches!(reader, "markdown" | "typst")
}

/// Whether the output names the bibliography a Markdown or Typst source
/// gave (`\bibliography`, `#bibliography`), which then has to be pinned.
fn writes_source_bibliography(reader: &str, writer: &str) -> bool {
    matches!(reader, "markdown" | "typst") && matches!(writer, "latex" | "typst")
}

/// Removes the `bibliography: false` line that dropping a bibliography leaves
/// in Markdown front matter, and the front matter itself when nothing else
/// is in it.
pub(crate) fn drop_false_bibliography(markdown: &str) -> String {
    let mut lines = markdown.split_inclusive('\n');
    let Some(opening) = lines.next().filter(|line| line.trim_end() == "---") else {
        return markdown.to_string();
    };
    let mut kept = Vec::new();
    let mut closing = None;
    for line in lines.by_ref() {
        if matches!(line.trim_end(), "---" | "...") {
            closing = Some(line);
            break;
        }
        if line.trim_end() != "bibliography: false" {
            kept.push(line);
        }
    }
    let Some(closing) = closing else {
        return markdown.to_string();
    };
    let body: String = lines.collect();
    if kept.is_empty() {
        return body.trim_start_matches(['\r', '\n']).to_string();
    }
    format!("{opening}{}{closing}{body}", kept.concat())
}

/// Build a deterministic converter plan for the text/document routes exposed
/// by the Tools page. PDF, image, spreadsheet, equation, and Mermaid inputs
/// have dedicated adapters and deliberately do not enter this table.
pub(crate) fn ad_hoc_plan(source: &str, target: &str) -> Option<AdHocPlan> {
    let (reader, source_name) = match source {
        "latex" | "equation" => ("latex", "source.tex"),
        "markdown" => ("markdown", "source.md"),
        "typst" => ("typst", "source.typ"),
        "html" => ("html", "source.html"),
        "docx" => ("docx", "source.docx"),
        _ => return None,
    };
    let (writer, output_name, binary_output, media_type) = match target {
        "latex" => ("latex", "converted.tex", false, "application/x-tex"),
        "markdown" => ("markdown", "converted.md", false, "text/markdown"),
        "typst" => ("typst", "converted.typ", false, "text/x-typst"),
        "html" => ("html5", "converted.html", false, "text/html"),
        "docx" => (
            "docx",
            "converted.docx",
            true,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        _ => return None,
    };
    if reader == writer {
        return None;
    }
    let supported = matches!(
        (source, target),
        ("latex", "html")
            | ("latex", "markdown")
            | ("latex", "typst")
            | ("latex", "docx")
            | ("markdown", "latex")
            | ("markdown", "typst")
            | ("typst", "latex")
            | ("typst", "docx")
            | ("typst", "html")
            | ("typst", "markdown")
            | ("html", "latex")
            | ("html", "typst")
            | ("docx", "latex")
            | ("docx", "typst")
            | ("equation", "typst")
    );
    if !supported {
        return None;
    }

    let mut args = vec![format!("--from={reader}"), format!("--to={writer}")];
    if source != "equation" {
        args.push("--standalone".into());
    }
    if source == "latex" && target == "typst" {
        args.push("--number-sections".into());
    }
    if source != "html" {
        args.push("--sandbox".into());
    }
    if target == "html" {
        args.push("--mathml".into());
    }
    if source == "docx" || source == "html" {
        args.push("--extract-media=assets".into());
    }
    if writes_natbib(reader, writer) {
        args.push("--natbib".into());
    }
    // LaTeX into Word or HTML: citations and \ref numbers become text.
    let references_filter = source == "latex" && matches!(target, "docx" | "html");
    if references_filter {
        args.extend([
            format!("--lua-filter={}", crate::pandoc_citations::FILTER_NAME),
            "--citeproc".into(),
        ]);
    }
    args.extend([
        "-o".into(),
        output_name.into(),
        "--".into(),
        source_name.into(),
    ]);
    Some(AdHocPlan {
        source_name,
        output_name,
        args,
        binary_output,
        media_type,
        references_filter,
        local_bibliography: writes_source_bibliography(reader, writer),
    })
}

pub(crate) const MAX_REPORT_LINES: usize = 200;
const MAX_REPORT_LINE_CHARS: usize = 240;

fn report_line(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(MAX_REPORT_LINE_CHARS).collect()
}

fn skipped_location(text: &str) -> Option<(&str, &str)> {
    let (head, location) = text.rsplit_once(" at ")?;
    let (_, position) = location.split_once(" line ")?;
    let (line, column) = position.split_once(" column ")?;
    let numeric =
        |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    (numeric(line) && numeric(column.trim_end())).then_some((head, position.trim_end()))
}

fn skipped_report(head: &str, position: Option<&str>) -> String {
    match position {
        Some(position) => report_line(&format!("Skipped {head} at line {position}")),
        None => report_line(&format!("Skipped {head}")),
    }
}

fn push_report_entry(entry: String, entries: &mut Vec<String>) {
    if !entry.is_empty() && !entries.contains(&entry) && entries.len() < MAX_REPORT_LINES {
        entries.push(entry);
    }
}

pub(crate) fn pandoc_report(log: &str) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    let mut warning: Option<String> = None;
    let mut warning_closed = false;
    let mut skipped: Option<String> = None;
    for line in log.lines() {
        if let Some(head) = skipped.as_ref() {
            if !line.starts_with('[') {
                if let Some((_, position)) = skipped_location(line) {
                    let head = format!("{head} ...'");
                    push_report_entry(skipped_report(&head, Some(position)), &mut entries);
                    skipped = None;
                }
                continue;
            }
            let head = format!("{head} ...'");
            push_report_entry(skipped_report(&head, None), &mut entries);
            skipped = None;
        }
        let continuation = line.starts_with(char::is_whitespace) && !line.trim().is_empty();
        if continuation {
            if let Some(current) = warning.as_mut().filter(|_| !warning_closed) {
                current.push(' ');
                current.push_str(line.trim());
                warning_closed = line.trim_end().ends_with(':');
            }
            continue;
        }
        if let Some(done) = warning.take() {
            push_report_entry(report_line(&done), &mut entries);
        }
        if let Some(rest) = line.strip_prefix("[WARNING] ") {
            warning_closed = rest.trim_end().ends_with(':');
            warning = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("[INFO] Skipped ") {
            match skipped_location(rest.trim_end()) {
                Some((head, position)) => {
                    push_report_entry(skipped_report(head, Some(position)), &mut entries)
                }
                None => skipped = Some(rest.trim_end().to_string()),
            }
        }
    }
    if let Some(done) = warning.take() {
        push_report_entry(report_line(&done), &mut entries);
    }
    if let Some(head) = skipped.take() {
        push_report_entry(skipped_report(&format!("{head} ...'"), None), &mut entries);
    }
    entries
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct TypstCheckDiagnostic {
    pub severity: &'static str,
    pub message: String,
    pub line: Option<u32>,
}

const MAX_CHECK_DIAGNOSTICS: usize = 50;

fn typst_check_location(location: &str, file: &str) -> Option<u32> {
    let span = oleafly_core::typst_log::parse_typst_location(location)?;
    oleafly_core::typst_log::typst_paths_match(&span.file, file).then_some(span.line)
}

pub(crate) fn typst_check_diagnostics(log: &str, file: &str) -> Vec<TypstCheckDiagnostic> {
    log.lines()
        .filter_map(|line| {
            let line = line.trim_end();
            [("error", "error: "), ("warning", "warning: ")]
                .into_iter()
                .find_map(|(severity, label)| {
                    let (line_number, message) = match line.strip_prefix(label) {
                        Some(message) => (None, message),
                        None => {
                            let (location, message) = line.split_once(&format!(": {label}"))?;
                            (typst_check_location(location, file), message)
                        }
                    };
                    Some(TypstCheckDiagnostic {
                        severity,
                        message: report_line(message),
                        line: line_number,
                    })
                })
        })
        .take(MAX_CHECK_DIAGNOSTICS)
        .collect()
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
    if writes_natbib(reader, writer) {
        args.push("--natbib".into());
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

impl ImportPlan {
    /// Point the new project's bibliography at the copied files `names`.
    /// With none, the source's own entry is dropped.
    pub fn add_bibliographies(&mut self, names: &[String]) {
        add_bibliography_args(&mut self.args, names);
    }
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

/// Formats whose writers turn citations and cross-references into text.
/// The Markdown, Typst and LaTeX writers keep `[@key]`, `@key` and `\cite`
/// as markup, so they skip citeproc.
pub(crate) fn export_renders_citations(format: &str) -> bool {
    matches!(format, "docx" | "html" | "epub" | "pptx" | "txt")
}

/// Where pandoc reads an export from.
pub(crate) struct ExportSource {
    /// The main document's path from the project root, as pandoc receives it.
    pub file_name: String,
    /// Pandoc's `--resource-path`: the main document's folder, then the
    /// project root, as the compile searches them.
    pub resource_path: String,
}

/// Citation inputs for an export.
pub(crate) struct ExportCitations<'a> {
    /// `export-references.lua`, which settles the bibliography and the
    /// cross-references before citeproc runs (rendered formats only).
    pub filter: Option<&'a Path>,
    /// Bibliographies the source's own compile passes explicitly (the
    /// Markdown engine's discovered .bib files).
    pub bibliographies: &'a [PathBuf],
}

/// The pandoc reader an export's main document goes through.
fn export_reader(file_name: &str) -> &'static str {
    let extension = Path::new(file_name)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    pandoc_reader(&extension).unwrap_or("latex")
}

/// The pandoc argv for one export. `None` means `format` is not an export
/// format.
pub(crate) fn export_args(
    format: &str,
    source: &ExportSource,
    output: &str,
    citations: Option<&ExportCitations<'_>>,
) -> Option<Vec<String>> {
    let (writer, _) = export_writer(format)?;
    let mut args = vec![format!("--to={writer}"), "-o".into(), output.into()];
    if !source.resource_path.is_empty() {
        args.push(format!("--resource-path={}", source.resource_path));
    }
    if export_needs_standalone(format) {
        args.push("--standalone".into());
    }
    match format {
        "pptx" => args.extend(["--slide-level".into(), "2".into()]),
        "html" => args.extend([
            "--standalone".into(),
            "--embed-resources".into(),
            "--mathml".into(),
        ]),
        "epub" => args.push("--toc".into()),
        _ => {}
    }
    let renders = export_renders_citations(format);
    let natbib = writes_natbib(export_reader(&source.file_name), writer);
    if natbib {
        args.push("--natbib".into());
    }
    if let Some(citations) = citations.filter(|_| renders || natbib) {
        args.extend(
            citations
                .bibliographies
                .iter()
                .map(|path| format!("--bibliography={}", path.to_string_lossy())),
        );
        // Filters and citeproc run in command-line order: the filter settles
        // the bibliography first.
        if let Some(filter) = citations.filter.filter(|_| renders) {
            args.push(format!("--lua-filter={}", filter.to_string_lossy()));
            args.push("--citeproc".into());
        }
    }
    args.extend(["--".into(), source.file_name.clone()]);
    Some(args)
}

/// Pandoc's Typst writer emits `font: (),`, which current Typst rejects.
/// Substitute a real font stack until upstream stops emitting the empty list.
/// A References heading right before `#bibliography(...)` becomes the
/// bibliography's title, since Typst adds its own heading.
pub(crate) fn fixup_typst_source(source: &str) -> String {
    let fixed = source.replace("font: (),", "font: (\"New Computer Modern\",),");
    title_bibliography_from_heading(&fixed).unwrap_or(fixed)
}

/// The index just past the `)` that closes a call opened before `open`.
fn typst_call_end(text: &str, open: usize) -> Option<usize> {
    let mut depth = 1_usize;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, character) in text[open..].char_indices() {
        if in_string {
            match character {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match character {
            '"' => in_string = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(open + offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn title_bibliography_from_heading(source: &str) -> Option<String> {
    let call = source.find("#bibliography(")?;
    let open = call + "#bibliography(".len();
    let close = typst_call_end(source, open)?;
    if source[open..close].contains("title:") {
        return None;
    }
    let mut before = source[..call].trim_end();
    // pandoc labels the heading: `= References` then `<references>`.
    if let Some(line_start) = before.rfind('\n') {
        let last = before[line_start + 1..].trim();
        if last.starts_with('<') && last.ends_with('>') {
            before = before[..line_start].trim_end();
        }
    }
    let line_start = before.rfind('\n').map_or(0, |at| at + 1);
    let heading = before[line_start..].trim();
    let title = heading.trim_start_matches('=');
    if title.len() == heading.len() || !title.starts_with(' ') || title.trim().is_empty() {
        return None;
    }
    Some(format!(
        "{}{}, title: [{}]{}",
        &source[..line_start],
        &source[call..close],
        title.trim(),
        &source[close..]
    ))
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
    fn rendered_exports_resolve_citations_and_cross_references() {
        let source = ExportSource {
            file_name: "main.tex".into(),
            resource_path: ".".into(),
        };
        let filter = Path::new("/tmp/export-references.lua");
        let bibliographies = [PathBuf::from("/p/refs.bib")];
        let citations = ExportCitations {
            filter: Some(filter),
            bibliographies: &bibliographies,
        };
        for format in ["docx", "html", "epub", "pptx", "txt"] {
            let args = export_args(format, &source, "out", Some(&citations)).unwrap();
            let filter_at = args
                .iter()
                .position(|arg| arg == "--lua-filter=/tmp/export-references.lua")
                .unwrap_or_else(|| panic!("{format} export has no references filter"));
            let citeproc_at = args
                .iter()
                .position(|arg| arg == "--citeproc")
                .unwrap_or_else(|| panic!("{format} export does not run citeproc"));
            assert!(
                filter_at < citeproc_at,
                "the filter settles the bibliography before citeproc reads it"
            );
            assert!(args.contains(&"--bibliography=/p/refs.bib".to_string()));
            assert!(args.contains(&"--resource-path=.".to_string()));
            assert_eq!(args.last().unwrap(), "main.tex");
        }
        for format in ["md", "typst", "tex"] {
            let args = export_args(format, &source, "out", Some(&citations)).unwrap();
            assert!(
                !args.iter().any(|arg| arg == "--citeproc"
                    || arg == "--natbib"
                    || arg.starts_with("--lua-filter")
                    || arg.starts_with("--bibliography")),
                "{format} keeps citations as markup"
            );
        }
        // Markdown and Typst into LaTeX write natbib commands, not `[@key]`.
        for main in ["main.md", "notes/main.markdown", "main.typ"] {
            let source = ExportSource {
                file_name: main.into(),
                resource_path: ".".into(),
            };
            let relative = [PathBuf::from("refs.bib")];
            let args = export_args(
                "tex",
                &source,
                "out.tex",
                Some(&ExportCitations {
                    filter: None,
                    bibliographies: &relative,
                }),
            )
            .unwrap();
            assert!(args.contains(&"--natbib".to_string()), "{main}");
            assert!(
                args.contains(&"--bibliography=refs.bib".to_string()),
                "{main}"
            );
            assert!(!args.contains(&"--citeproc".to_string()), "{main}");
            let word = export_args("docx", &source, "out.docx", None).unwrap();
            assert!(!word.contains(&"--natbib".to_string()), "{main}");
        }
    }

    #[test]
    fn markdown_and_typst_to_latex_write_natbib_citations() {
        for (extension, target, natbib) in [
            ("md", "latex", true),
            ("markdown", "latex", true),
            ("typ", "latex", true),
            ("md", "typst", false),
            ("typ", "markdown", false),
            ("docx", "latex", false),
            ("html", "latex", false),
        ] {
            let plan = import_plan(extension, target).unwrap();
            let separator = plan.args.iter().position(|arg| arg == "--").unwrap();
            assert_eq!(
                plan.args[..separator].contains(&"--natbib".to_string()),
                natbib,
                "{extension} -> {target}"
            );
        }
        for (source, target, natbib) in [
            ("markdown", "latex", true),
            ("typst", "latex", true),
            ("markdown", "typst", false),
            ("html", "latex", false),
            ("docx", "latex", false),
        ] {
            let plan = ad_hoc_plan(source, target).unwrap();
            let separator = plan.args.iter().position(|arg| arg == "--").unwrap();
            assert_eq!(
                plan.args[..separator].contains(&"--natbib".to_string()),
                natbib,
                "ad-hoc {source} -> {target}"
            );
        }
    }

    #[test]
    fn ad_hoc_rendered_targets_keep_citations_and_references_readable() {
        for target in ["docx", "html"] {
            let plan = ad_hoc_plan("latex", target).unwrap();
            let filter_at = plan
                .args
                .iter()
                .position(|arg| arg == "--lua-filter=export-references.lua")
                .unwrap_or_else(|| panic!("latex -> {target} has no references filter"));
            let citeproc_at = plan
                .args
                .iter()
                .position(|arg| arg == "--citeproc")
                .unwrap_or_else(|| panic!("latex -> {target} does not run citeproc"));
            assert!(filter_at < citeproc_at);
            assert!(plan.references_filter);
        }
        let markdown = ad_hoc_plan("latex", "markdown").unwrap();
        assert!(!markdown.args.contains(&"--citeproc".to_string()));
        assert!(!markdown.references_filter);
    }

    #[test]
    fn imports_point_the_bibliography_at_local_files() {
        let mut plan = import_plan("md", "latex").unwrap();
        plan.add_bibliographies(&["My-Library.bib".into(), "refs.bib".into()]);
        let separator = plan.args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(
            plan.args[separator - 2..separator],
            ["--bibliography=My-Library.bib", "--bibliography=refs.bib"]
        );
        let mut none = import_plan("md", "latex").unwrap();
        none.add_bibliographies(&[]);
        assert!(none
            .args
            .contains(&"--metadata=bibliography=false".to_string()));
        assert_eq!(none.args.last().unwrap(), "source.md");
    }

    #[test]
    fn ad_hoc_markdown_and_typst_outputs_pin_the_bibliography() {
        for (source, target, pinned) in [
            ("markdown", "latex", true),
            ("markdown", "typst", true),
            ("typst", "latex", true),
            ("latex", "markdown", false),
            ("latex", "docx", false),
            ("docx", "latex", false),
        ] {
            assert_eq!(
                ad_hoc_plan(source, target).unwrap().local_bibliography,
                pinned,
                "{source} -> {target}"
            );
        }
    }

    #[test]
    fn a_dropped_bibliography_leaves_no_front_matter_entry() {
        assert_eq!(
            drop_false_bibliography("---\nbibliography: false\n---\n\n# Method\n"),
            "# Method\n"
        );
        assert_eq!(
            drop_false_bibliography(
                "---\r\nbibliography: false\r\ntitle: Paper\r\n---\r\n\r\nText\r\n"
            ),
            "---\r\ntitle: Paper\r\n---\r\n\r\nText\r\n"
        );
        for untouched in [
            "# Method\n\nbibliography: false\n",
            "---\nbibliography: refs.bib\n---\n\nText\n",
            "---\nbibliography: false\n",
        ] {
            assert_eq!(drop_false_bibliography(untouched), untouched);
        }
    }

    #[test]
    fn typst_bibliography_keeps_one_heading() {
        let source =
            "See @smith2020.\n\n= References\n<references>\n\n\n#bibliography((\"refs.bib\"))\n";
        let fixed = fixup_typst_source(source);
        assert!(
            fixed.contains("#bibliography((\"refs.bib\"), title: [References])"),
            "{fixed}"
        );
        assert!(!fixed.contains("= References"), "{fixed}");
        assert_eq!(fixed, fixup_typst_source(&fixed));
        // A heading with body text after it is a real section, not the
        // bibliography's title.
        let kept = "= References\n\nSome text.\n\n#bibliography(\"refs.bib\")\n";
        assert_eq!(fixup_typst_source(kept), kept);
    }

    #[test]
    fn ad_hoc_routes_are_exactly_whitelisted() {
        for (source, target) in [
            ("latex", "html"),
            ("latex", "markdown"),
            ("latex", "typst"),
            ("latex", "docx"),
            ("markdown", "latex"),
            ("markdown", "typst"),
            ("typst", "latex"),
            ("html", "latex"),
            ("docx", "latex"),
            ("html", "typst"),
            ("docx", "typst"),
            ("typst", "docx"),
            ("typst", "html"),
            ("typst", "markdown"),
        ] {
            let plan = ad_hoc_plan(source, target)
                .unwrap_or_else(|| panic!("missing ad-hoc route {source} -> {target}"));
            assert_eq!(
                plan.args.contains(&"--sandbox".to_string()),
                source != "html",
                "sandbox flag mismatch for {source} -> {target}"
            );
            assert!(plan.args.contains(&format!("--from={source}")) || source == "docx");
        }
        assert!(ad_hoc_plan("latex", "latex").is_none());
        assert!(ad_hoc_plan("pdf", "latex").is_none());
        assert!(ad_hoc_plan("docx", "markdown").is_none());
        assert!(ad_hoc_plan("unknown", "html").is_none());
    }

    #[test]
    fn typst_tools_routes_read_and_write_typst() {
        for (source, target, reader, writer) in [
            ("html", "typst", "html", "typst"),
            ("docx", "typst", "docx", "typst"),
            ("typst", "docx", "typst", "docx"),
            ("typst", "html", "typst", "html5"),
            ("typst", "markdown", "typst", "markdown"),
        ] {
            let plan = ad_hoc_plan(source, target)
                .unwrap_or_else(|| panic!("missing ad-hoc route {source} -> {target}"));
            assert!(plan.args.contains(&format!("--from={reader}")));
            assert!(plan.args.contains(&format!("--to={writer}")));
            assert!(plan.args.contains(&"--standalone".to_string()));
            assert!(!plan.references_filter, "{source} -> {target}");
            assert!(!plan.local_bibliography, "{source} -> {target}");
        }
        assert!(ad_hoc_plan("typst", "html")
            .unwrap()
            .args
            .contains(&"--mathml".to_string()));
        for source in ["html", "docx"] {
            assert!(ad_hoc_plan(source, "typst")
                .unwrap()
                .args
                .contains(&"--extract-media=assets".to_string()));
        }
        assert!(ad_hoc_plan("latex", "typst")
            .unwrap()
            .args
            .contains(&"--number-sections".to_string()));
        for (source, target) in [
            ("markdown", "typst"),
            ("latex", "markdown"),
            ("html", "typst"),
        ] {
            assert!(
                !ad_hoc_plan(source, target)
                    .unwrap()
                    .args
                    .contains(&"--number-sections".to_string()),
                "{source} -> {target}"
            );
        }
        let word = ad_hoc_plan("typst", "docx").unwrap();
        assert!(word.binary_output);
        assert_eq!(word.output_name, "converted.docx");
        assert_eq!(
            ad_hoc_plan("docx", "typst").unwrap().output_name,
            "converted.typ"
        );
    }

    #[test]
    fn equation_route_writes_a_bare_typst_fragment() {
        let plan = ad_hoc_plan("equation", "typst").unwrap();
        assert_eq!(plan.source_name, "source.tex");
        assert_eq!(plan.output_name, "converted.typ");
        assert!(plan.args.contains(&"--from=latex".to_string()));
        assert!(plan.args.contains(&"--to=typst".to_string()));
        assert!(plan.args.contains(&"--sandbox".to_string()));
        assert!(!plan.args.contains(&"--standalone".to_string()));
        assert!(!plan.args.contains(&"--number-sections".to_string()));
        assert!(!plan.local_bibliography);
        for target in ["latex", "html", "markdown", "docx"] {
            assert!(ad_hoc_plan("equation", target).is_none(), "{target}");
        }
    }

    #[test]
    fn pandoc_report_keeps_skipped_markup_and_warnings_once() {
        let log = "[INFO] Could not load include file amsmath.sty at source.tex line 2 column 50\n\
                   [INFO] Skipped '\\maketitle' at source.tex line 7 column 11\n\
                   [INFO] Skipped '\\centering' at source.tex line 10 column 28\n\
                   [INFO] Skipped '\\centering' at source.tex line 10 column 28\n\
                   [INFO] Loaded some resource\n\
                   [WARNING] Could not convert TeX math \\begin{equation}\n\
                   \x20  \\int_0^1 f(x)\\,dx \\label{eq:1}\n\
                   \x20 \\end{equation}, rendering as TeX:\n\
                   \x20 0^1 f(x)\\,dx \\label{eq:1}\n\
                   \x20                    ^\n\
                   \x20 unexpected control sequence \\label\n\
                   [WARNING] Citeproc: citation knuth not found\n\
                   [INFO] Skipped '\\begin{tikzpicture}[\n\
                   \x20       node distance=7mm,\n\
                   \x20     ]\n\
                   \\end{tikzpicture}' at source.tex line 120 column 3\n";
        assert_eq!(
            pandoc_report(log),
            vec![
                "Skipped '\\maketitle' at line 7 column 11".to_string(),
                "Skipped '\\centering' at line 10 column 28".to_string(),
                "Could not convert TeX math \\begin{equation} \\int_0^1 f(x)\\,dx \\label{eq:1} \\end{equation}, rendering as TeX:".to_string(),
                "Citeproc: citation knuth not found".to_string(),
                "Skipped '\\begin{tikzpicture}[ ...' at line 120 column 3".to_string(),
            ]
        );
        assert!(pandoc_report("").is_empty());
        let many: String = (0..400)
            .map(|line| format!("[INFO] Skipped '\\x{line}' at source.tex line {line} column 1\n"))
            .collect();
        assert_eq!(pandoc_report(&many).len(), MAX_REPORT_LINES);
    }

    #[test]
    fn typst_check_diagnostics_locate_lines_in_the_converted_file() {
        let log = "converted.typ:12:5: error: unknown variable: foo\n\
                   converted.typ:3:1: warning: unknown font family: bar\n\
                   ./converted.typ:20:2: error: file not found (searched at figs/plot.pdf)\n\
                   lib.typ:4:2: error: deep failure\n\
                   error: failed to load file\n\
                   compiled with errors\n";
        let diagnostics = typst_check_diagnostics(log, "converted.typ");
        assert_eq!(
            diagnostics,
            vec![
                TypstCheckDiagnostic {
                    severity: "error",
                    message: "unknown variable: foo".into(),
                    line: Some(12),
                },
                TypstCheckDiagnostic {
                    severity: "warning",
                    message: "unknown font family: bar".into(),
                    line: Some(3),
                },
                TypstCheckDiagnostic {
                    severity: "error",
                    message: "file not found (searched at figs/plot.pdf)".into(),
                    line: Some(20),
                },
                TypstCheckDiagnostic {
                    severity: "error",
                    message: "deep failure".into(),
                    line: None,
                },
                TypstCheckDiagnostic {
                    severity: "error",
                    message: "failed to load file".into(),
                    line: None,
                },
            ]
        );
    }

    #[test]
    fn typst_check_diagnostics_accept_windows_paths_to_the_converted_file() {
        let log = "C:\\Users\\me\\AppData\\Local\\Temp\\convert\\converted.typ:12:5: error: unknown variable: foo\n\
                   .\\converted.typ:3:1: warning: unknown font family: bar\n\
                   C:\\Users\\me\\lib.typ:4:2: error: deep failure\n";
        let lines: Vec<_> = typst_check_diagnostics(log, "converted.typ")
            .into_iter()
            .map(|diagnostic| diagnostic.line)
            .collect();
        assert_eq!(lines, [Some(12), Some(3), None]);
    }

    #[test]
    fn html_reader_extracts_media_outside_the_sandbox() {
        let html = ad_hoc_plan("html", "latex").unwrap();
        assert!(html.args.contains(&"--extract-media=assets".to_string()));
        assert!(!html.args.contains(&"--sandbox".to_string()));

        let docx = ad_hoc_plan("docx", "latex").unwrap();
        assert!(docx.args.contains(&"--extract-media=assets".to_string()));
        assert!(docx.args.contains(&"--sandbox".to_string()));
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
