use super::*;
use oleafly_core::typst_toolchain::TypstSource;
use std::path::PathBuf;

fn version(text: &str) -> ToolchainVersion {
    ToolchainVersion::parse(text).unwrap()
}

fn capabilities(version: &str) -> TypstCapabilities {
    oleafly_core::typst_toolchain::capabilities_for(version).clone()
}

fn strings(arguments: &[OsString]) -> Vec<String> {
    arguments
        .iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect()
}

fn bundled_typst() -> Option<ResolvedTypst> {
    let triple = crate::biber_toolchain::host_triple_guess()?;
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
    let bundled = oleafly_core::typst_toolchain::bundled_typst_version().clone();
    path.is_file().then(|| ResolvedTypst {
        path,
        capabilities: capabilities(&bundled.to_string()),
        version: bundled,
        source: TypstSource::Bundled,
    })
}

fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    for (name, text) in files {
        let path = root.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    root
}

const DOCUMENT: &str = "#set heading(numbering: \"1.\")\n\
#set math.equation(numbering: \"(1)\")\n\
= Introduction <sec:intro>\n\
Inline $x$ math is skipped.\n\
$ E = m c^2 $ <eq:energy>\n\
#figure(table(columns: 2, [a], [b]), caption: [Two *cells*]) <tab:cells>\n\
#figure(rect(), caption: [A box])\n\
#include \"part.typ\"\n";

const PART: &str = "== Details\nSee @sec:intro.\n";

#[test]
fn versions_from_0_15_use_eval_and_older_ones_use_query() {
    assert_eq!(query_method(&version("0.15.0")), TypstQueryMethod::Eval);
    assert_eq!(query_method(&version("0.16.2")), TypstQueryMethod::Eval);
    assert_eq!(query_method(&version("0.14.2")), TypstQueryMethod::Query);
    assert_eq!(query_method(&version("0.11.1")), TypstQueryMethod::Query);
}

#[test]
fn query_arguments_name_the_selector_and_only_flags_the_version_knows() {
    let flags = [
        TypstCompileFlag::PackagePath(PathBuf::from("/pkg")),
        TypstCompileFlag::PackageCachePath(PathBuf::from("/cache")),
        TypstCompileFlag::Ppi(144),
    ];
    let old = strings(&query_args(
        &insight_target(TypstQueryMethod::Query),
        &capabilities("0.11.1"),
        Path::new("/project"),
        "main.typ",
        &flags,
    ));
    assert_eq!(
        old,
        [
            "query",
            "main.typ",
            QUERY_SELECTOR,
            "--root",
            "/project",
            "--format",
            "json",
            "--diagnostic-format",
            "short",
        ]
    );
    let newer = strings(&query_args(
        &insight_target(TypstQueryMethod::Query),
        &capabilities("0.14.2"),
        Path::new("/project"),
        "main.typ",
        &flags,
    ));
    assert_eq!(newer[0], "--color=never");
    assert!(newer.ends_with(&[
        "--package-path".to_owned(),
        "/pkg".to_owned(),
        "--package-cache-path".to_owned(),
        "/cache".to_owned(),
    ]));
    assert!(!newer.iter().any(|argument| argument == "--ppi"));
}

#[test]
fn eval_arguments_read_the_main_file_and_end_with_the_expression() {
    let arguments = strings(&query_args(
        &insight_target(TypstQueryMethod::Eval),
        &capabilities("0.15.1"),
        Path::new("/project"),
        "paper/main.typ",
        &[],
    ));
    assert_eq!(
        &arguments[..4],
        ["--color=never", "eval", "--in", "paper/main.typ"]
    );
    assert_eq!(
        &arguments[arguments.len() - 2..],
        ["--".to_owned(), EVAL_EXPRESSION.to_owned()]
    );
}

#[test]
fn query_targets_can_read_one_field_of_a_label() {
    let arguments = strings(&query_args(
        &TypstQueryTarget::Query {
            selector: "<pdfpc-file>",
            field: Some("value"),
        },
        &capabilities("0.11.1"),
        Path::new("/project"),
        "main.typ",
        &[TypstCompileFlag::FontPath(PathBuf::from("/project/fonts"))],
    ));
    assert_eq!(
        arguments,
        [
            "query",
            "main.typ",
            "<pdfpc-file>",
            "--field",
            "value",
            "--root",
            "/project",
            "--format",
            "json",
            "--diagnostic-format",
            "short",
            "--font-path",
            "/project/fonts",
        ]
    );
}

#[test]
fn eval_targets_carry_their_own_expression() {
    let arguments = strings(&query_args(
        &TypstQueryTarget::Eval("query(<pdfpc>)"),
        &capabilities("0.15.1"),
        Path::new("/project"),
        "main.typ",
        &[],
    ));
    assert_eq!(
        &arguments[arguments.len() - 2..],
        ["--".to_owned(), "query(<pdfpc>)".to_owned()]
    );
}

#[test]
fn query_json_becomes_elements_with_plain_text_and_bare_labels() {
    let json = r#"[
        {"func":"heading","level":1,"numbering":"1.","body":{"func":"sequence","children":[{"func":"text","text":"Intro"},{"func":"space"},{"func":"strong","body":{"func":"text","text":"now"}}]},"label":"<sec:intro>"},
        {"func":"figure","kind":"table","numbering":"1","caption":{"func":"caption","separator":{"func":"text","text":": "},"body":{"func":"text","text":"Two cells"}},"label":"<tab:cells>"},
        {"func":"equation","block":true,"numbering":null,"body":{"func":"text","text":"x"}},
        {"func":"cite","key":"<knuth1984>","supplement":null},
        {"func":"outline"}
    ]"#;
    let (elements, truncated) = parse_elements(json).unwrap();
    assert!(!truncated);
    assert_eq!(
        elements,
        vec![
            TypstInsightElement {
                kind: TypstInsightKind::Heading,
                text: "Intro now".into(),
                label: Some("sec:intro".into()),
                level: Some(1),
                figure_kind: None,
                numbered: true,
                page: None,
            },
            TypstInsightElement {
                kind: TypstInsightKind::Figure,
                text: "Two cells".into(),
                label: Some("tab:cells".into()),
                level: None,
                figure_kind: Some("table".into()),
                numbered: true,
                page: None,
            },
            TypstInsightElement {
                kind: TypstInsightKind::Equation,
                text: "x".into(),
                label: None,
                level: None,
                figure_kind: None,
                numbered: false,
                page: None,
            },
            TypstInsightElement {
                kind: TypstInsightKind::Citation,
                text: "knuth1984".into(),
                label: None,
                level: None,
                figure_kind: None,
                numbered: false,
                page: None,
            },
        ]
    );
}

#[test]
fn eval_json_keeps_pages_and_unquotes_custom_figure_kinds() {
    let json = r#"[{"func":"figure","page":3,"label":"fig:x","level":null,"kind":"\"algorithm\"","numbered":true,"key":null,"body":null,"caption":{"func":"text","text":"Steps"}}]"#;
    let (elements, _) = parse_elements(json).unwrap();
    assert_eq!(elements[0].page, Some(3));
    assert_eq!(elements[0].figure_kind.as_deref(), Some("algorithm"));
    assert_eq!(elements[0].text, "Steps");
    assert!(parse_elements("not json").is_err());
}

#[test]
fn long_text_is_cut_and_whitespace_collapsed() {
    let long = serde_json::json!({"func": "text", "text": format!("a  b\n{}", "x".repeat(400))});
    let text = plain_text(&long);
    assert!(text.starts_with("a b x"));
    assert_eq!(text.chars().count(), MAX_TEXT_CHARS + 1);
    assert!(text.ends_with('…'));
}

#[test]
fn failures_keep_positioned_errors_and_fall_back_to_the_first_line() {
    let log = "warning: query is deprecated\n\
               main.typ:3:5: error: unknown variable: foo\n\
               sections\\a.typ:1:2: error: file not found\n\
               error: failed to load package\n";
    assert_eq!(
        parse_failure(log, Some(1)),
        vec![
            TypstQueryDiagnostic {
                message: "unknown variable: foo".into(),
                file: Some("main.typ".into()),
                line: Some(3),
                column: Some(5),
            },
            TypstQueryDiagnostic {
                message: "file not found".into(),
                file: Some("sections/a.typ".into()),
                line: Some(1),
                column: Some(2),
            },
            TypstQueryDiagnostic {
                message: "failed to load package".into(),
                file: None,
                line: None,
                column: None,
            },
        ]
    );
    assert_eq!(
        parse_failure("", Some(2))[0].message,
        "Typst stopped with exit code 2."
    );
    assert_eq!(parse_failure("panicked", None)[0].message, "panicked");
}

#[test]
fn serializes_a_tagged_result_for_the_bridge() {
    let ready = TypstDocumentInsights::Ready {
        typst_version: "0.15.1".into(),
        method: TypstQueryMethod::Eval,
        elements: Vec::new(),
        truncated: false,
    };
    assert_eq!(
        serde_json::to_value(&ready).unwrap(),
        serde_json::json!({
            "status": "ready",
            "typstVersion": "0.15.1",
            "method": "eval",
            "elements": [],
            "truncated": false,
        })
    );
}

fn run_bundled(typst: &ResolvedTypst, root: &Path) -> TypstDocumentInsights {
    run_insights(
        &TypstQueryContext {
            typst,
            root,
            main_doc: "main.typ",
            packages: None,
            settings: None,
            offline: true,
        },
        QUERY_TIMEOUT,
    )
    .unwrap()
}

#[test]
fn bundled_typst_lists_document_elements_with_both_methods() {
    let Some(typst) = bundled_typst() else {
        eprintln!("Typst sidecar is not staged; skipping the document insights check");
        return;
    };
    let root = project(&[("main.typ", DOCUMENT), ("part.typ", PART)]);
    for method in [TypstQueryMethod::Eval, TypstQueryMethod::Query] {
        let mut pinned = typst.clone();
        if method == TypstQueryMethod::Query {
            pinned.version = version("0.14.2");
        }
        let TypstDocumentInsights::Ready {
            elements,
            method: used,
            ..
        } = run_bundled(&pinned, root.path())
        else {
            panic!("expected insights from {method:?}");
        };
        assert_eq!(used, method);
        let summary: Vec<(TypstInsightKind, &str, Option<&str>)> = elements
            .iter()
            .map(|element| {
                (
                    element.kind,
                    element.text.as_str(),
                    element.label.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                (TypstInsightKind::Heading, "Introduction", Some("sec:intro")),
                (TypstInsightKind::Equation, "E = m c2", Some("eq:energy")),
                (TypstInsightKind::Figure, "Two cells", Some("tab:cells")),
                (TypstInsightKind::Figure, "A box", None),
                (TypstInsightKind::Heading, "Details", None),
            ],
            "{method:?}"
        );
        assert_eq!(elements[2].figure_kind.as_deref(), Some("table"));
        assert!(elements.iter().all(|element| element.numbered));
        let pages: Vec<Option<u32>> = elements.iter().map(|element| element.page).collect();
        if method == TypstQueryMethod::Eval {
            assert!(pages.iter().all(|page| *page == Some(1)));
        } else {
            assert!(pages.iter().all(Option::is_none));
        }
    }
}

#[test]
fn bundled_typst_reports_errors_with_their_position() {
    let Some(typst) = bundled_typst() else {
        eprintln!("Typst sidecar is not staged; skipping the document insights failure check");
        return;
    };
    let root = project(&[("main.typ", "= Title\n#unknown-call()\n")]);
    let TypstDocumentInsights::Failed { diagnostics, .. } = run_bundled(&typst, root.path()) else {
        panic!("expected a failure");
    };
    assert_eq!(diagnostics[0].file.as_deref(), Some("main.typ"));
    assert_eq!(diagnostics[0].line, Some(2));
    assert!(
        diagnostics[0].message.contains("unknown"),
        "{diagnostics:?}"
    );
}
