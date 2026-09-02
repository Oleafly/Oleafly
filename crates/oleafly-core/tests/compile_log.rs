use oleafly_core::{
    parse_latex_log, LogCategory, LogDiagnostic, LogSeverity, MAX_COMPILE_LOG_BYTES,
};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn parse(lines: &[&str]) -> Vec<LogDiagnostic> {
    parse_latex_log(&lines.join("\n"), None)
}

#[test]
fn parses_a_bang_style_error_with_its_context_excerpt() {
    let diags = parse(&[
        "! Undefined control sequence.",
        "l.33 \\badmacro",
        "               ",
        "? ",
    ]);
    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(d.severity, LogSeverity::Error);
    assert_eq!(d.category, LogCategory::Error);
    assert_eq!(d.message, "Undefined control sequence.");
    assert_eq!(d.file, None);
    assert_eq!(d.line, Some(33));
    assert_eq!(
        d.error_context.as_deref(),
        Some("! Undefined control sequence.\nl.33 \\badmacro")
    );
}

#[test]
fn attributes_file_and_line_for_file_line_style_errors() {
    let diags = parse(&[
        "./main.tex:12: Undefined control sequence.",
        "l.12 \\badmacro",
        "",
    ]);
    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(d.severity, LogSeverity::Error);
    assert_eq!(d.category, LogCategory::Error);
    assert_eq!(d.message, "Undefined control sequence.");
    assert_eq!(d.file.as_deref(), Some("./main.tex"));
    assert_eq!(d.line, Some(12));
    assert_eq!(
        d.error_context.as_deref(),
        Some("./main.tex:12: Undefined control sequence.\nl.12 \\badmacro")
    );
}

#[test]
fn attributes_diagnostics_to_the_innermost_file_on_the_stack() {
    let diags = parse(&[
        "(./main.tex [1] first page",
        "(./chapters/ch1.tex",
        "LaTeX Warning: Reference `fig:one' on page 1 undefined on input line 5.",
        ") back in the root file",
        "LaTeX Warning: Reference `fig:two' on page 2 undefined on input line 40.",
        ")",
    ]);
    assert_eq!(diags.len(), 2);
    assert_eq!(diags[0].file.as_deref(), Some("./chapters/ch1.tex"));
    assert_eq!(diags[0].line, Some(5));
    assert_eq!(diags[1].file.as_deref(), Some("./main.tex"));
    assert_eq!(diags[1].line, Some(40));
}

#[test]
fn parses_undefined_reference_and_citation_warnings() {
    let diags = parse(&[
        "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 10.",
        "LaTeX Warning: Citation `knuth1984' on page 2 undefined on input line 12.",
        "LaTeX Warning: There were undefined references.",
    ]);
    assert_eq!(diags.len(), 2);
    assert_eq!(diags[0].severity, LogSeverity::Warning);
    assert_eq!(diags[0].category, LogCategory::UndefinedReference);
    assert_eq!(diags[0].line, Some(10));
    assert_eq!(diags[0].message, "Cannot find reference `fig:x`.");
    assert_eq!(diags[1].severity, LogSeverity::Warning);
    assert_eq!(diags[1].category, LogCategory::UndefinedCitation);
    assert_eq!(diags[1].line, Some(12));
    assert_eq!(diags[1].message, "Cannot find citation `knuth1984`.");
}

#[test]
fn parses_overfull_and_underfull_box_warnings_as_typesetting_diagnostics() {
    let diags = parse(&[
        "Overfull \\hbox (15.36pt too wide) in paragraph at lines 21--22",
        "[]\\OT1/cmr/m/n/10 This line sticks out into the margin",
        "",
        "Underfull \\vbox (badness 10000) detected at line 19",
        " []",
        "",
    ]);
    assert_eq!(diags.len(), 2);
    assert_eq!(diags[0].severity, LogSeverity::Typesetting);
    assert_eq!(diags[0].category, LogCategory::OverfullBox);
    assert_eq!(diags[0].line, Some(21));
    assert_eq!(diags[0].message, "Overfull \\hbox (15.36pt too wide)");
    assert_eq!(diags[1].severity, LogSeverity::Typesetting);
    assert_eq!(diags[1].category, LogCategory::UnderfullBox);
    assert_eq!(diags[1].line, Some(19));
    assert_eq!(diags[1].message, "Underfull \\vbox (badness 10000)");
}

#[test]
fn merges_package_warning_continuation_lines_and_picks_up_the_input_line() {
    let diags = parse(&[
        "Package hyperref Warning: Token not allowed in a PDF string (Unicode):",
        "(hyperref)                removing `math shift' on input line 42.",
        "",
    ]);
    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(d.severity, LogSeverity::Warning);
    assert_eq!(d.category, LogCategory::PackageWarning);
    assert_eq!(d.line, Some(42));
    assert_eq!(
        d.message,
        "Package hyperref: Token not allowed in a PDF string (Unicode):\n(hyperref)\tremoving `math shift'."
    );
}

#[test]
fn parses_missing_character_warnings() {
    let diags = parse(&["Missing character: There is no ő in font nullfont!", ""]);
    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(d.severity, LogSeverity::Warning);
    assert_eq!(d.category, LogCategory::MissingCharacter);
    assert_eq!(
        d.message,
        "Missing character: There is no ő in font nullfont!"
    );
    assert_eq!(d.line, None);
}

#[test]
fn accumulates_multi_line_error_text_until_the_line_excerpt() {
    let diags = parse(&[
        "! Package amsmath Error: \\begin{split} won't work here.",
        "Try typing  <return>  to proceed.",
        "If that doesn't work, type  X <return>  to quit.",
        "l.5 \\begin{split}",
        "",
    ]);
    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(d.severity, LogSeverity::Error);
    assert_eq!(
        d.message,
        "Package amsmath: \\begin{split} won't work here.\nTry typing  <return>  to proceed.\nIf that doesn't work, type  X <return>  to quit."
    );
    assert_eq!(
        d.error_context.as_deref(),
        Some("! Package amsmath Error: \\begin{split} won't work here.\nTry typing  <return>  to proceed.\nIf that doesn't work, type  X <return>  to quit.\nl.5 \\begin{split}")
    );
}

#[test]
fn drops_the_redundant_latex_prefix_from_latex_error_messages() {
    let diags = parse(&[
        "! LaTeX Error: Environment itemize undefined.",
        "",
        "See the LaTeX manual or LaTeX Companion for explanation.",
    ]);
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].message, "Environment itemize undefined.");
    assert_eq!(
        diags[0].error_context.as_deref(),
        Some("! LaTeX Error: Environment itemize undefined.")
    );
}

#[test]
fn returns_nothing_for_empty_and_garbage_input() {
    assert!(parse_latex_log("", None).is_empty());
    let garbage = parse(&[
        "This is pdfTeX, Version 3.141592653-2.6-1.7.11 (TeX Live 2024) (preloaded format=pdflatex)",
        " restricted \\write18 enabled.",
        "entering extended mode",
        "**main.tex",
        "\u{0}\u{1} binary junk \u{2}",
    ]);
    assert!(garbage.is_empty());
}

#[test]
fn surfaces_oleafly_biber_mode_diagnostics_and_biblatex_rerun_warnings() {
    let diags = parse(&[
        "Package biblatex Warning: Please (re)run Biber on the file:",
        "(biblatex)                _oleafly_entry",
        "(biblatex)                and rerun LaTeX afterwards.",
        "[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.",
        "[Oleafly] Biber was not found (mode A): GUI launches often have a minimal PATH",
    ]);
    assert!(diags.iter().any(
        |d| d.category == LogCategory::Biber && d.message.contains("Bibliography needs Biber")
    ));
    assert!(diags.iter().any(|d| d.category == LogCategory::Biber
        && d.severity == LogSeverity::Error
        && d.message.contains("mode A")));
}

#[test]
fn only_parses_the_first_max_compile_log_bytes() {
    let filler = format!("{}\n", "x".repeat(1023)).repeat(MAX_COMPILE_LOG_BYTES / 1024);
    let log = format!("{filler}! Undefined control sequence.\nl.3 \\bad\n");
    assert!(parse_latex_log(&log, None).is_empty());
}

#[test]
fn attributes_diagnostics_before_any_paren_to_the_root_file() {
    let warning = "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 10.";
    let diags = parse_latex_log(warning, Some("/proj/main.tex"));
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].file.as_deref(), Some("/proj/main.tex"));

    let error = "! Undefined control sequence.\nl.3 \\bad\n";
    let diags = parse_latex_log(error, Some("/proj/main.tex"));
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].file.as_deref(), Some("/proj/main.tex"));
}

#[test]
fn reports_no_pages_of_output_with_the_log_line_as_its_message() {
    let diags = parse(&["No pages of output.", ""]);
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].severity, LogSeverity::Error);
    assert_eq!(diags[0].message, "No pages of output.");
    assert_eq!(diags[0].error_context, None);
}

#[test]
fn serializes_with_the_frontend_field_names() {
    let diags = parse(&["! Undefined control sequence.", "l.33 \\badmacro", ""]);
    let json = serde_json::to_value(&diags).unwrap();
    assert_eq!(
        json,
        serde_json::json!([{
            "severity": "error",
            "category": "error",
            "file": null,
            "line": 33,
            "message": "Undefined control sequence.",
            "errorContext": "! Undefined control sequence.\nl.33 \\badmacro"
        }])
    );
    let info = parse(&["Package graphics Info: Driver file: xetex", ""]);
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json[0]["severity"], "info");
    assert_eq!(json[0]["category"], "info");
    assert_eq!(json[0].get("errorContext"), None);
    let boxes = parse(&[
        "Underfull \\vbox (badness 10000) detected at line 19",
        " []",
        "LaTeX Warning: Citation `k' on page 2 undefined on input line 12.",
    ]);
    let json = serde_json::to_value(&boxes).unwrap();
    assert_eq!(json[0]["severity"], "typesetting");
    assert_eq!(json[0]["category"], "underfull-box");
    assert_eq!(json[1]["category"], "undefined-citation");
}

#[test]
fn drops_an_error_line_split_by_a_unicode_line_separator_like_the_typescript_parser() {
    let plain = parse(&["! Undefined control sequence.", "l.3 \\bad", ""]);
    assert_eq!(plain.len(), 1);
    for separator in ['\u{2028}', '\u{2029}'] {
        let line = format!("! Undefined control{separator}sequence.");
        let diags = parse(&[line.as_str(), "l.3 \\bad", ""]);
        assert!(
            diags.is_empty(),
            "U+{:04X} should block the error pattern",
            separator as u32
        );
    }
}

#[test]
fn does_not_treat_next_line_as_whitespace_like_the_typescript_parser() {
    let diags = parse(&["! Undefined control sequence.", "\u{85}", "l.3 \\bad", ""]);
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].line, Some(3));
    assert_eq!(diags[0].message, "Undefined control sequence.\n\u{85}");
    assert_eq!(
        diags[0].error_context.as_deref(),
        Some("! Undefined control sequence.\n\u{85}\nl.3 \\bad")
    );
}

#[test]
fn treats_the_byte_order_mark_as_whitespace_like_the_typescript_parser() {
    let diags = parse(&["! Undefined control sequence.", "\u{feff}", "l.3 \\bad", ""]);
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].line, None);
    assert_eq!(diags[0].message, "Undefined control sequence.");
    assert_eq!(
        diags[0].error_context.as_deref(),
        Some("! Undefined control sequence.")
    );
    let diags = parse(&["[Oleafly] Bibliography needs Biber (biblatex).\u{feff}", ""]);
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].message, "Bibliography needs Biber (biblatex).");
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("compile-log")
}

fn golden_pairs(dir: &Path) -> Vec<(PathBuf, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut pairs: Vec<(PathBuf, PathBuf)> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "log"))
        .map(|log| {
            let expected = log.with_extension("expected.json");
            (log, expected)
        })
        .collect();
    pairs.sort();
    pairs
}

fn assert_golden(log_path: &Path, expected_path: &Path) {
    let log = std::fs::read_to_string(log_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", log_path.display()));
    let expected: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(expected_path)
            .unwrap_or_else(|error| panic!("read {}: {error}", expected_path.display())),
    )
    .unwrap();
    let root_file = expected["rootFile"].as_str();
    let started = Instant::now();
    let diagnostics = parse_latex_log(&log, root_file);
    eprintln!(
        "{}: {} bytes, {} diagnostics in {:?}",
        log_path.display(),
        log.len(),
        diagnostics.len(),
        started.elapsed()
    );
    let actual = serde_json::to_value(diagnostics).unwrap();
    let expected_diagnostics = &expected["diagnostics"];
    let actual_list = actual.as_array().unwrap();
    let expected_list = expected_diagnostics.as_array().unwrap();
    for (index, (a, e)) in actual_list.iter().zip(expected_list.iter()).enumerate() {
        assert_eq!(a, e, "{}: diagnostic {index} differs", log_path.display());
    }
    assert_eq!(
        actual_list.len(),
        expected_list.len(),
        "{}: diagnostic count differs",
        log_path.display()
    );
}

#[test]
fn matches_the_typescript_parser_on_golden_logs() {
    let pairs = golden_pairs(&fixture_dir());
    assert!(!pairs.is_empty(), "no golden fixtures found");
    for (log, expected) in &pairs {
        assert_golden(log, expected);
    }
    if let Some(extra) = std::env::var_os("OLEAFLY_COMPILE_LOG_PARITY_DIR") {
        for (log, expected) in golden_pairs(Path::new(&extra)) {
            assert_golden(&log, &expected);
        }
    }
}

fn parse_on_a_two_megabyte_stack(log: String) -> Vec<LogDiagnostic> {
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || parse_latex_log(&log, Some("main.tex")))
        .unwrap();
    let joined = handle.join();
    assert!(
        joined.is_ok(),
        "parse_latex_log panicked or overflowed the stack"
    );
    joined.unwrap()
}

#[test]
fn a_line_chaining_many_output_box_warnings_parses_on_a_small_stack() {
    let fragment = "Overfull \\hbox (1.0pt too wide) has occurred while \\output is active [3]";
    let diags = parse_on_a_two_megabyte_stack(fragment.repeat(100_000));
    assert_eq!(diags.len(), MAX_COMPILE_LOG_BYTES / fragment.len());
    assert!(diags.iter().all(|d| d.category == LogCategory::OverfullBox
        && d.severity == LogSeverity::Typesetting
        && d.message == "Overfull \\hbox (1.0pt too wide) in page 3"
        && d.file.as_deref() == Some("main.tex")));
}

#[test]
fn a_line_chaining_many_biber_warnings_parses_on_a_small_stack() {
    let fragment = "Biber warning: WARN - I didn't find a database entry for 'knuth'";
    let diags = parse_on_a_two_megabyte_stack(fragment.repeat(100_000));
    assert!(!diags.is_empty());
    assert!(
        diags
            .iter()
            .all(|d| d.category == LogCategory::Biber
                && d.message == "No bib entry found for 'knuth'")
    );
}

#[test]
fn parses_a_megabyte_log_quickly() {
    let mut corpus = String::new();
    for (log, _) in golden_pairs(&fixture_dir()) {
        corpus.push_str(&std::fs::read_to_string(log).unwrap());
        corpus.push('\n');
    }
    if corpus.is_empty() {
        corpus = "! Undefined control sequence.\nl.33 \\badmacro\n\n(./chapters/ch1.tex\nLaTeX Warning: Reference `fig:one' on page 1 undefined on input line 5.\n)\n".to_string();
    }
    let mut log = String::new();
    while log.len() < 1024 * 1024 {
        log.push_str(&corpus);
    }
    parse_latex_log(&log, Some("main.tex"));
    let started = Instant::now();
    let diagnostics = parse_latex_log(&log, Some("main.tex"));
    let elapsed = started.elapsed();
    eprintln!(
        "parse_latex_log: {} bytes, {} lines, {} diagnostics in {:?}",
        log.len(),
        log.lines().count(),
        diagnostics.len(),
        elapsed
    );
    assert!(!diagnostics.is_empty());
    let ceiling = if cfg!(debug_assertions) { 2000 } else { 200 };
    assert!(
        elapsed.as_millis() < ceiling,
        "parsing 1 MiB took {elapsed:?}, ceiling {ceiling} ms"
    );
}
