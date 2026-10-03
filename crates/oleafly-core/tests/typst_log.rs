use std::collections::BTreeMap;
use std::path::Path;

use oleafly_core::typst_log::{
    parse_typst_diagnostics, parse_typst_location, typst_display_end, typst_log_category,
    typst_path_relative_to, typst_paths_match, TypstDiagnostic, TypstSeverity, TypstSpan,
};
use oleafly_core::LogCategory;

const VERSIONS: [&str; 6] = ["0.11.1", "0.12.0", "0.13.1", "0.14.2", "0.15.0", "0.15.1"];

fn fixture(version: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("typst-log")
        .join(format!("{version}.log"));
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn cases(version: &str) -> BTreeMap<String, String> {
    let mut cases = BTreeMap::new();
    let text = fixture(version);
    let mut name: Option<String> = None;
    let mut body = String::new();
    for line in text.lines() {
        if let Some(next) = line.strip_prefix("=== ") {
            if let Some(name) = name.take() {
                cases.insert(name, std::mem::take(&mut body));
            }
            name = Some(next.to_owned());
        } else {
            body.push_str(line);
            body.push('\n');
        }
    }
    if let Some(name) = name {
        cases.insert(name, body);
    }
    cases
}

fn parsed(version: &str, case: &str) -> Vec<TypstDiagnostic> {
    let cases = cases(version);
    let log = cases
        .get(case)
        .unwrap_or_else(|| panic!("{version} fixture has no {case} case"));
    parse_typst_diagnostics(log)
}

fn single(version: &str, case: &str) -> TypstDiagnostic {
    let mut diagnostics = parsed(version, case);
    assert_eq!(diagnostics.len(), 1, "{version} {case}: {diagnostics:#?}");
    diagnostics.remove(0)
}

fn span(file: &str, line: u32, column: u32, width: Option<u32>) -> Option<TypstSpan> {
    Some(TypstSpan {
        file: file.to_owned(),
        line,
        column,
        width,
    })
}

fn at_least(version: &str, minimum: &str) -> bool {
    let key = |value: &str| {
        value
            .split('.')
            .map(|part| part.parse::<u32>().unwrap())
            .collect::<Vec<_>>()
    };
    key(version) >= key(minimum)
}

#[test]
fn every_version_reports_the_position_and_span_of_common_errors() {
    for version in VERSIONS {
        let unknown = single(version, "unknown_variable");
        assert_eq!(unknown.severity, TypstSeverity::Error);
        assert_eq!(unknown.message, "unknown variable: foo");
        assert_eq!(unknown.span, span("main.typ", 3, 7, Some(3)), "{version}");
        assert!(unknown.hints.is_empty());
        assert!(unknown.trace.is_empty());

        let expected = single(version, "expected_found");
        assert_eq!(expected.message, "expected integer or auto, found string");
        assert_eq!(expected.span, span("main.typ", 1, 16, Some(5)));

        let missing = single(version, "file_not_found");
        assert_eq!(
            missing.message,
            "file not found (searched at /project/figures/missing.png)"
        );
        assert_eq!(missing.span, span("main.typ", 2, 7, Some(21)));

        let unclosed = single(version, "unclosed_delimiter");
        assert_eq!(unclosed.message, "unclosed delimiter");
        assert_eq!(unclosed.span, span("main.typ", 3, 2, Some(1)));

        let depth = single(version, "show_rule_depth");
        assert_eq!(depth.message, "maximum show rule depth exceeded");
        assert_eq!(depth.span, span("main.typ", 1, 21, Some(16)));
        let depth_hints: &[&str] = if at_least(version, "0.14.0") {
            &[
                "maybe a show rule matches its own output",
                "maybe there are too deeply nested elements",
            ]
        } else {
            &["check whether the show rule matches its own output"]
        };
        assert_eq!(depth.hints, depth_hints, "{version}");

        let wide = single(version, "wide_characters");
        assert_eq!(wide.span, span("main.typ", 1, 5, Some(3)));

        let multiline = single(version, "multiline_span");
        assert_eq!(multiline.message, "cannot add dictionary and integer");
        assert_eq!(multiline.span, span("main.typ", 1, 9, None));
    }
}

#[test]
fn every_version_keeps_hints_and_unlocated_warnings() {
    for version in VERSIONS {
        let math = single(version, "math_hints");
        assert_eq!(math.span, span("main.typ", 3, 1, Some(3)));
        if at_least(version, "0.12.0") {
            assert_eq!(math.hints.len(), 2, "{version}");
            assert!(math.hints[0].starts_with("if you meant to display multiple letters as is"));
            assert!(math.hints[1].ends_with("try placing it in quotes: `\"foo\"`"));
        } else {
            assert!(math.hints.is_empty());
        }

        let font = parsed(version, "unknown_font");
        if at_least(version, "0.12.0") {
            assert_eq!(font.len(), 1);
            assert_eq!(font[0].severity, TypstSeverity::Warning);
            assert_eq!(font[0].message, "unknown font family: nosuchfontfamily");
            assert_eq!(font[0].span, span("main.typ", 1, 16, Some(18)));
        } else {
            assert!(font.is_empty());
        }

        let converge = parsed(version, "layout_convergence");
        assert!(converge
            .iter()
            .all(|diagnostic| diagnostic.severity == TypstSeverity::Warning));
        assert_eq!(converge[0].span, None);
        if at_least(version, "0.15.0") {
            assert_eq!(converge.len(), 3);
            assert_eq!(
                converge[0].message,
                "document did not converge within five attempts"
            );
            assert_eq!(converge[0].hints.len(), 2);
            assert_eq!(converge[1].span, span("main.typ", 2, 18, Some(9)));
            assert_eq!(converge[2].span, span("main.typ", 3, 9, Some(7)));
            assert_eq!(
                converge[1].hints[0],
                "the following values were observed:\n- run 1: `0`\n- run 2: `1`\n- run 3: `2`\n- run 4: `3`\n- run 5: `4`\n- final: `5`"
            );
            assert_eq!(
                converge[1].hints[1],
                "see https://typst.app/help/state-convergence for help"
            );
        } else {
            assert_eq!(converge.len(), 1);
            assert_eq!(
                converge[0].message,
                "layout did not converge within 5 attempts"
            );
            assert_eq!(
                converge[0].hints,
                ["check if any states or queries are updating themselves"]
            );
        }

        let locate = parsed(version, "locate_callback");
        match version {
            "0.11.1" => assert!(locate.is_empty()),
            "0.12.0" => {
                assert_eq!(locate.len(), 1);
                assert_eq!(locate[0].severity, TypstSeverity::Warning);
                assert_eq!(locate[0].span, span("main.typ", 1, 1, Some(18)));
                assert_eq!(locate[0].hints, ["use a `context` expression instead"]);
            }
            _ => {
                assert_eq!(locate.len(), 1);
                assert_eq!(locate[0].severity, TypstSeverity::Error);
                assert_eq!(locate[0].span, span("main.typ", 1, 8, Some(10)));
            }
        }
    }
}

#[test]
fn every_version_reports_package_failures() {
    for version in VERSIONS {
        let not_found = single(version, "package_not_found");
        assert_eq!(
            not_found.message,
            "package not found (searched for @local/nosuchpkg:0.1.0)"
        );
        assert_eq!(not_found.span, span("main.typ", 1, 8, Some(24)));

        let version_missing = single(version, "package_version");
        if at_least(version, "0.12.0") {
            assert_eq!(
                version_missing.message,
                "package found, but version 99.0.0 does not exist (latest is 0.5.2)"
            );
        } else {
            assert_eq!(
                version_missing.message,
                "package not found (searched for @preview/cetz:99.0.0)"
            );
        }
        assert_eq!(version_missing.span, span("main.typ", 1, 8, Some(22)));

        let offline = single(version, "package_offline");
        assert!(
            offline
                .message
                .starts_with("failed to download package (https://packages.typst.org/preview/tablex-0.0.8.tar.gz"),
            "{}",
            offline.message
        );
        assert_eq!(offline.span, span("main.typ", 1, 8, Some(23)));
    }
}

#[test]
fn every_version_keeps_the_trace_back_to_the_calling_file() {
    for version in VERSIONS {
        let modern = at_least(version, "0.15.0");
        let call = |line: u32, legacy_column: u32, width: u32| {
            if modern {
                TypstSpan {
                    file: "main.typ".into(),
                    line,
                    column: 1,
                    width: None,
                }
            } else {
                TypstSpan {
                    file: "main.typ".into(),
                    line,
                    column: legacy_column,
                    width: Some(width),
                }
            }
        };

        let cyclic = single(version, "cyclic_import");
        assert_eq!(cyclic.message, "cyclic import");
        assert_eq!(cyclic.span, span("b.typ", 1, 8, Some(10)));
        assert_eq!(cyclic.trace, [call(1, 8, 7)], "{version}");
        assert_eq!(cyclic.user_span(), cyclic.span.as_ref());

        let function = single(version, "function_trace");
        assert_eq!(function.span, span("main.typ", 1, 12, Some(7)));
        assert_eq!(function.trace, [call(2, 1, 4)]);

        let package = single(version, "package_trace");
        assert_eq!(package.message, "cannot add integer and string");
        assert_eq!(
            package.span,
            span("@local/mypkg:0.1.0/lib.typ", 2, 2, Some(7))
        );
        assert_eq!(package.trace, [call(4, 1, 7)]);
        assert_eq!(package.user_span(), Some(&call(4, 1, 7)));

        let nested = single(version, "subdirectory");
        assert_eq!(nested.message, "unknown variable: undefined-name");
        assert_eq!(nested.span, span("chapters/intro.typ", 2, 1, Some(14)));
        assert_eq!(nested.hints.len(), 1);
        assert!(nested.hints[0].starts_with("if you meant to use subtraction"));
        assert_eq!(nested.trace.len(), 1);
        assert_eq!(nested.trace[0].file, "main.typ");
    }
}

#[test]
fn unresolved_labels_and_citations_are_categorized_in_every_version() {
    for version in VERSIONS {
        let label = single(version, "label_missing");
        assert_eq!(
            label.message,
            "label `<nolabel>` does not exist in the document"
        );
        assert_eq!(label.span, span("main.typ", 1, 4, Some(8)));
        assert_eq!(label.category(), LogCategory::UndefinedReference);

        let citation = single(version, "citation_missing");
        assert_eq!(citation.span, span("main.typ", 1, 1, Some(18)));
        assert_eq!(
            citation.category(),
            LogCategory::UndefinedCitation,
            "{version}"
        );

        assert_eq!(
            single(version, "unknown_variable").category(),
            LogCategory::Error
        );
    }
    assert_eq!(
        typst_log_category(
            TypstSeverity::Warning,
            "unknown font family: nosuchfontfamily"
        ),
        LogCategory::PackageWarning
    );
}

#[test]
fn every_fixture_case_parses_without_stray_diagnostics() {
    for version in VERSIONS {
        let all = parse_typst_diagnostics(&fixture(version));
        let expected = cases(version)
            .values()
            .map(|log| parse_typst_diagnostics(log).len())
            .sum::<usize>();
        assert_eq!(all.len(), expected, "{version}");
        assert!(all.iter().all(|diagnostic| !diagnostic.message.is_empty()));
    }
}

#[test]
fn windows_paths_parse_with_drive_letters_and_backslashes() {
    let log = "error: unknown variable: foo\n  ┌─ C:\\Users\\runner\\paper\\chapters\\intro.typ:12:4\n   │\n12 │ Hello #foo\n   │        ^^^\n\nwarning: unknown font family: x\n  ┌─ chapters\\intro.typ:3:16\n  │\n3 │ #set text(font: \"x\")\n  │                 ^^^\n\nhelp: error occurred in this call of function `f`\n  ┌─ D:\\paper\\main.typ:9:1\n  │\n9 │ #f(1)\n  │  ^^^^\n";
    let diagnostics = parse_typst_diagnostics(log);
    assert_eq!(diagnostics.len(), 2);
    assert_eq!(
        diagnostics[0].span,
        span(
            "C:\\Users\\runner\\paper\\chapters\\intro.typ",
            12,
            4,
            Some(3)
        )
    );
    assert_eq!(
        diagnostics[1].span,
        span("chapters\\intro.typ", 3, 16, Some(3))
    );
    assert_eq!(
        diagnostics[1].trace,
        [span("D:\\paper\\main.typ", 9, 1, Some(4)).unwrap()]
    );

    let short = parse_typst_diagnostics(
        "C:\\work\\main.typ:9:2: warning: unused label\n.\\main.typ:3:1: error: bad\nmain.typ:4:0: help: error occurred in this call\n",
    );
    assert_eq!(short.len(), 2);
    assert_eq!(short[0].span, span("C:\\work\\main.typ", 9, 2, None));
    assert_eq!(short[1].span, span(".\\main.typ", 3, 1, None));
    assert_eq!(short[1].trace, [span("main.typ", 4, 0, None).unwrap()]);

    let crlf = parse_typst_diagnostics(
        "error: x\r\n  ┌─ C:\\p\\main.typ:2:3\r\n  │\r\n2 │ abc x\r\n  │    ^\r\n",
    );
    assert_eq!(crlf[0].span, span("C:\\p\\main.typ", 2, 3, Some(1)));
}

#[test]
fn locations_split_from_the_right() {
    assert_eq!(
        parse_typst_location("C:\\work\\main.typ:9:2"),
        span("C:\\work\\main.typ", 9, 2, None)
    );
    assert_eq!(
        parse_typst_location("@preview/cetz:0.3.1/src/lib.typ:12:0"),
        span("@preview/cetz:0.3.1/src/lib.typ", 12, 0, None)
    );
    assert_eq!(
        parse_typst_location("/home/me/paper/main.typ:1:1"),
        span("/home/me/paper/main.typ", 1, 1, None)
    );
    assert_eq!(parse_typst_location("C:\\work\\main.typ"), None);
    assert_eq!(parse_typst_location(":3:4"), None);
    assert_eq!(parse_typst_location("main.typ:0:4"), None);
}

#[test]
fn reported_paths_match_the_expected_source_in_every_form() {
    for reported in [
        "snippet.typ",
        "./snippet.typ",
        ".\\snippet.typ",
        "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\oleafly-typst-snippet-1\\snippet.typ",
        "\\\\?\\C:\\Temp\\snippet.typ",
        "/private/var/folders/x/oleafly-typst-snippet-1/snippet.typ",
    ] {
        assert!(typst_paths_match(reported, "snippet.typ"), "{reported}");
    }
    for reported in [
        "other.typ",
        "lib/snippet.typ",
        "@preview/pkg:0.1.0/snippet.typ",
        "C:\\snippet.typ.bak",
        "",
    ] {
        assert!(!typst_paths_match(reported, "snippet.typ"), "{reported}");
    }
    assert!(typst_paths_match(
        "chapters\\intro.typ",
        "chapters/intro.typ"
    ));
}

#[test]
fn display_widths_map_back_to_character_offsets() {
    assert_eq!(typst_display_end("Hello #foo world.", 7, 3), 10);
    assert_eq!(typst_display_end("\t漢字 #foo and more", 5, 3), 8);
    assert_eq!(typst_display_end("漢字", 0, 2), 1);
    assert_eq!(typst_display_end("a\tb", 1, 1), 2);
    assert_eq!(typst_display_end("abc", 2, 10), 3);
}

#[test]
fn reported_paths_become_relative_to_the_directory_typst_ran_in() {
    let relative =
        |reported: &str, directory: &str| typst_path_relative_to(reported, Path::new(directory));
    assert_eq!(relative("main.typ", "/p"), "main.typ");
    assert_eq!(
        relative("./chapters\\intro.typ", "/p"),
        "chapters/intro.typ"
    );
    assert_eq!(relative("/p/paper/main.typ", "/p"), "paper/main.typ");
    assert_eq!(relative("/p/paper/main.typ", "/p/"), "paper/main.typ");
    assert_eq!(relative("/elsewhere/main.typ", "/p"), "/elsewhere/main.typ");
    assert_eq!(relative("/pp/main.typ", "/p"), "/pp/main.typ");
    assert_eq!(
        relative(
            r"\\?\C:\Users\Runner\Temp\.tmp1\main.typ",
            r"C:\Users\runner\Temp\.tmp1"
        ),
        "main.typ"
    );
    assert_eq!(
        relative(
            r"\\?\C:\Users\runner\Temp\.tmp1\sub\a.typ",
            r"\\?\C:\Users\runner\Temp\.tmp1"
        ),
        "sub/a.typ"
    );
    assert_eq!(
        relative(r"\\?\UNC\server\share\p\main.typ", r"\\server\share\p"),
        "main.typ"
    );
    assert_eq!(
        relative("@preview/cetz:0.3.4/src/lib.typ", "/p"),
        "@preview/cetz:0.3.4/src/lib.typ"
    );
}
