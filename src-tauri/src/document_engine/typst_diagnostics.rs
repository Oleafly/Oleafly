use std::collections::HashMap;
use std::path::{Path, PathBuf};

use oleafly_core::typst_log::{self, TypstDiagnostic, TypstSeverity};
use oleafly_core::{LogDiagnostic, LogSeverity};

use super::CompileError;

const MAX_SOURCE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SOURCE_LINE_CHARS: usize = 4096;
const MAX_LOCATED_ERRORS: usize = 200;

pub(super) fn parse_typst_errors(log: &str) -> Vec<CompileError> {
    let mut errors: Vec<CompileError> = typst_log::parse_typst_diagnostics(log)
        .into_iter()
        .map(compile_error)
        .collect();
    errors.sort_by_key(|error| error.kind != "error");
    errors
}

fn compile_error(diagnostic: TypstDiagnostic) -> CompileError {
    let span = diagnostic.user_span().cloned();
    CompileError {
        line: span.as_ref().map(|span| span.line),
        file: span.as_ref().map(|span| span.file.clone()),
        column: span.as_ref().map(|span| span.column + 1),
        end_column: span
            .as_ref()
            .and_then(|span| span.width.map(|width| span.column + 1 + width)),
        explanation: humanize_typst_error(&diagnostic.message).map(str::to_owned),
        kind: diagnostic.severity.as_str().to_owned(),
        message: diagnostic.message,
        hints: diagnostic.hints,
        source_line: None,
        code: None,
    }
}

pub(super) fn humanize_typst_error(message: &str) -> Option<&'static str> {
    let m = message.trim();
    if m.starts_with("unknown variable: ") {
        return Some("Typst does not recognize this name. Check for a typo, define it with #let before you use it, or import it from the file or package that defines it.");
    }
    if m.starts_with("unknown font family: ") {
        return Some("Typst cannot find this font, so it uses a fallback font. Check the name against Available fonts under Body font in Document settings. To use a font that is not listed, add its file to the fonts folder of the project. If Use system fonts is off, fonts installed on this computer are skipped.");
    }
    if m.starts_with("file not found") {
        return Some("Typst cannot find this file. Check the path. Relative paths start from the folder of the file that uses them. Paths that start with / start from the project root.");
    }
    if m.starts_with("package not found") {
        return Some("Typst cannot find this package. Check the package name and version in the import line.");
    }
    if m.starts_with("package found, but version") {
        return Some("The package exists, but this version does not. Import a published version instead, such as the latest one named in the message.");
    }
    if m.starts_with("failed to download package") {
        return Some("Typst could not download this package. Check your internet connection or turn off offline mode in Settings, then compile again. Once downloaded, the package is cached and works offline.");
    }
    if m.starts_with("expected ") && m.contains(", found ") {
        return Some("This value has the wrong type. The message says which type Typst expected and which one it got.");
    }
    if typst_log::is_unresolved_typst_label(m) {
        return Some("Nothing in the document has this label. Check the spelling, or add the label right after the heading, figure or equation you want to refer to. If it is a citation, check that the key is in the bibliography.");
    }
    if typst_log::is_unresolved_typst_citation(m) {
        return Some("This key is not in the bibliography. Check the spelling, or add the entry to the bibliography file.");
    }
    if m.starts_with("cyclic import") {
        return Some("Two files import each other, directly or through other files. Move the shared definitions into a separate file that both can import.");
    }
    if m.starts_with("maximum show rule depth exceeded") {
        return Some("A show rule keeps matching its own output. Change the rule so that what it returns no longer matches.");
    }
    if m.starts_with("unclosed ") {
        return Some("A bracket, brace, parenthesis or quote opened here is never closed. Add the closing one.");
    }
    if m.contains("did not converge") {
        return Some("The layout kept changing between passes. This usually means a state, counter or query depends on its own result. Numbers and references may be wrong until you break that loop.");
    }
    None
}

pub(super) fn attach_typst_sources(
    project_dir: &Path,
    log_dir: &Path,
    errors: &mut [CompileError],
) {
    let Ok(root) = project_dir.canonicalize() else {
        return;
    };
    let mut sources: HashMap<PathBuf, Option<String>> = HashMap::new();
    for error in errors.iter_mut().take(MAX_LOCATED_ERRORS) {
        let (Some(file), Some(line)) = (error.file.clone(), error.line) else {
            continue;
        };
        if typst_log::is_typst_package_path(&file) {
            continue;
        }
        let Some((relative, path)) = project_source(project_dir, log_dir, &root, &file) else {
            continue;
        };
        error.file = Some(relative);
        let text = sources
            .entry(path)
            .or_insert_with_key(|path| read_source(path));
        let Some(source) = text
            .as_deref()
            .and_then(|text| text.lines().nth((line as usize).checked_sub(1)?))
            .map(|source| source.trim_end_matches('\r'))
        else {
            continue;
        };
        if source.chars().count() > MAX_SOURCE_LINE_CHARS {
            continue;
        }
        refine_columns(error, source);
        error.source_line = Some(source.to_owned());
    }
}

fn windows_absolute(file: &str) -> bool {
    let bytes = file.as_bytes();
    file.starts_with("\\\\")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/'))
}

fn project_source(
    project_dir: &Path,
    log_dir: &Path,
    root: &Path,
    file: &str,
) -> Option<(String, PathBuf)> {
    let absolute = Path::new(file).is_absolute() || windows_absolute(file);
    let mut normalized = file.replace('\\', "/");
    while let Some(rest) = normalized.strip_prefix("./") {
        normalized = rest.to_owned();
    }
    let candidate = if absolute {
        PathBuf::from(file)
    } else {
        log_dir.join(&normalized)
    };
    let canonical = candidate
        .canonicalize()
        .ok()
        .filter(|path| path.is_file())?;
    let inside = canonical.strip_prefix(root).ok()?;
    let relative = if !absolute && log_dir == project_dir {
        normalized
    } else {
        inside
            .components()
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/")
    };
    Some((relative, canonical))
}

fn read_source(path: &Path) -> Option<String> {
    let size = std::fs::metadata(path).ok()?.len();
    if size > MAX_SOURCE_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn refine_columns(error: &mut CompileError, source: &str) {
    let Some(column) = error.column.filter(|column| *column > 0) else {
        return;
    };
    let characters: Vec<char> = source.chars().collect();
    let start = (column as usize - 1).min(characters.len());
    let end = match error.end_column {
        Some(end) if end > column => typst_log::typst_display_end(source, start, end - column),
        _ => characters.len(),
    }
    .max(start);
    let utf16 = |count: usize| {
        characters[..count]
            .iter()
            .map(|character| character.len_utf16())
            .sum::<usize>()
    };
    error.column = u32::try_from(utf16(start) + 1).ok();
    error.end_column = u32::try_from(utf16(end) + 1).ok();
}

pub(super) fn typst_log_diagnostics(errors: &[CompileError]) -> Vec<LogDiagnostic> {
    errors
        .iter()
        .map(|error| {
            let (severity, log_severity) = if error.kind == "error" {
                (TypstSeverity::Error, LogSeverity::Error)
            } else {
                (TypstSeverity::Warning, LogSeverity::Warning)
            };
            LogDiagnostic {
                severity: log_severity,
                message: error.message.clone(),
                file: error.file.clone(),
                line: error.line,
                category: typst_log::typst_log_category(severity, &error.message),
                error_context: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_core::LogCategory;

    const VERSION_LOGS: [(&str, &str); 6] = [
        (
            "0.11.1",
            include_str!("../../../crates/oleafly-core/tests/fixtures/typst-log/0.11.1.log"),
        ),
        (
            "0.12.0",
            include_str!("../../../crates/oleafly-core/tests/fixtures/typst-log/0.12.0.log"),
        ),
        (
            "0.13.1",
            include_str!("../../../crates/oleafly-core/tests/fixtures/typst-log/0.13.1.log"),
        ),
        (
            "0.14.2",
            include_str!("../../../crates/oleafly-core/tests/fixtures/typst-log/0.14.2.log"),
        ),
        (
            "0.15.0",
            include_str!("../../../crates/oleafly-core/tests/fixtures/typst-log/0.15.0.log"),
        ),
        (
            "0.15.1",
            include_str!("../../../crates/oleafly-core/tests/fixtures/typst-log/0.15.1.log"),
        ),
    ];

    fn case(log: &str, name: &str) -> String {
        let marker = format!("=== {name}\n");
        let start = log.find(&marker).expect("fixture case") + marker.len();
        let rest = &log[start..];
        rest[..rest.find("=== ").unwrap_or(rest.len())].to_owned()
    }

    #[test]
    fn human_diagnostics_keep_column_span_hints_and_explanations() {
        let errors = parse_typst_errors(
            "warning: unknown font family: nosuchfontfamily\n  ┌─ main.typ:1:16\n  │\n1 │ #set text(font: \"NoSuchFontFamily\")\n  │                 ^^^^^^^^^^^^^^^^^^\n\nerror: unknown variable: foo\n  ┌─ main.typ:3:1\n  │\n3 │ $foo$ and text.\n  │  ^^^\n  │\n  = hint: if you meant to display multiple letters as is, try adding spaces between each letter: `f o o`\n  = hint: or if you meant to display this as text, try placing it in quotes: `\"foo\"`\n\n",
        );
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[0].file.as_deref(), Some("main.typ"));
        assert_eq!(errors[0].line, Some(3));
        assert_eq!(errors[0].column, Some(2));
        assert_eq!(errors[0].end_column, Some(5));
        assert_eq!(errors[0].hints.len(), 2);
        assert!(errors[0]
            .explanation
            .as_deref()
            .is_some_and(|text| text.starts_with("Typst does not recognize this name")));
        assert_eq!(errors[1].kind, "warning");
        assert_eq!(errors[1].column, Some(17));
        assert_eq!(errors[1].end_column, Some(35));
        assert!(errors[1].explanation.is_some());
    }

    #[test]
    fn errors_inside_packages_point_at_the_calling_line() {
        for (version, log) in VERSION_LOGS {
            let errors = parse_typst_errors(&case(log, "package_trace"));
            assert_eq!(errors.len(), 1, "{version}");
            assert_eq!(errors[0].file.as_deref(), Some("main.typ"), "{version}");
            assert_eq!(errors[0].line, Some(4));
            assert_eq!(errors[0].column, Some(2));
        }
    }

    #[test]
    fn common_typst_errors_get_plain_english_explanations_in_every_version() {
        let explained = [
            "unknown_variable",
            "math_hints",
            "unknown_font",
            "file_not_found",
            "package_not_found",
            "package_version",
            "package_offline",
            "expected_found",
            "label_missing",
            "citation_missing",
            "cyclic_import",
            "show_rule_depth",
            "unclosed_delimiter",
            "layout_convergence",
            "subdirectory",
            "wide_characters",
        ];
        for (version, log) in VERSION_LOGS {
            for name in explained {
                for error in parse_typst_errors(&case(log, name)) {
                    assert!(
                        error.explanation.is_some(),
                        "{version} {name}: {}",
                        error.message
                    );
                }
            }
            for name in ["function_trace", "multiline_span"] {
                for error in parse_typst_errors(&case(log, name)) {
                    assert_eq!(error.explanation, None, "{version} {name}");
                }
            }
        }
        assert_eq!(
            humanize_typst_error("expected expression"),
            None,
            "syntax errors without a found type are not type errors"
        );
        assert!(humanize_typst_error("unclosed string").is_some());
        assert!(
            humanize_typst_error("unknown font family: nope").is_some_and(|text| text
                .contains("Document settings")
                && text.contains("fonts folder"))
        );
    }

    fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        for (path, text) in files {
            let path = directory.path().join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        directory
    }

    #[test]
    fn source_lines_and_utf16_columns_come_from_the_named_file() {
        let directory = project(&[
            ("main.typ", "= Title\r\n\r\nHello #foo world.\r\n"),
            ("chapters/intro.typ", "\t漢字 😀 #bar and more\n"),
        ]);
        let root = directory.path();
        let mut errors = parse_typst_errors(
            "error: unknown variable: foo\n  ┌─ main.typ:3:7\n  │\n3 │ Hello #foo world.\n  │        ^^^\n\nerror: unknown variable: bar\n  ┌─ chapters\\intro.typ:1:7\n  │\n1 │   漢字 😀 #bar and more\n  │            ^^^\n",
        );
        attach_typst_sources(root, root, &mut errors);
        assert_eq!(errors[0].file.as_deref(), Some("main.typ"));
        assert_eq!(errors[0].source_line.as_deref(), Some("Hello #foo world."));
        assert_eq!(
            (errors[0].column, errors[0].end_column),
            (Some(8), Some(11))
        );
        assert_eq!(errors[1].file.as_deref(), Some("chapters/intro.typ"));
        assert_eq!(
            errors[1].source_line.as_deref(),
            Some("\t漢字 😀 #bar and more")
        );
        let source: Vec<u16> = "\t漢字 😀 #bar and more".encode_utf16().collect();
        let from = errors[1].column.unwrap() as usize - 1;
        let to = errors[1].end_column.unwrap() as usize - 1;
        assert_eq!(String::from_utf16(&source[from..to]).unwrap(), "bar");
    }

    #[test]
    fn absolute_paths_inside_the_project_become_project_relative() {
        let directory = project(&[("chapters/intro.typ", "#let x = (\n  a: 1,\n) + 3\n")]);
        let root = directory.path();
        let absolute = root.join("chapters").join("intro.typ");
        let mut errors = parse_typst_errors(&format!(
            "error: cannot add dictionary and integer\n  ┌─ {}:1:9\n  │  \n1 │   #let x = (\n  │ ╭──────────^\n2 │ │   a: 1,\n3 │ │ ) + 3\n  │ ╰─────^\n",
            absolute.display()
        ));
        attach_typst_sources(root, root, &mut errors);
        assert_eq!(errors[0].file.as_deref(), Some("chapters/intro.typ"));
        assert_eq!(errors[0].column, Some(10));
        assert_eq!(errors[0].end_column, Some(11));
    }

    #[test]
    fn files_outside_the_project_and_package_files_are_not_read() {
        let outside = project(&[("secret.typ", "top secret\n")]);
        let directory = project(&[("main.typ", "ok\n")]);
        let root = directory.path();
        let mut errors = parse_typst_errors(&format!(
            "{}:1:0: error: unknown variable: top\n../secret.typ:1:0: error: unknown variable: top\n@preview/pkg:0.1.0/lib.typ:1:0: error: unknown variable: top\nmain.typ:9:0: error: unknown variable: ok\n",
            outside.path().join("secret.typ").display()
        ));
        attach_typst_sources(root, root, &mut errors);
        assert!(errors.iter().all(|error| error.source_line.is_none()));
        assert_eq!(
            errors[2].file.as_deref(),
            Some("@preview/pkg:0.1.0/lib.typ")
        );
    }

    fn bundled_typst() -> Option<PathBuf> {
        let triple = crate::biber_toolchain::host_triple_guess()?;
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("typst-{triple}{}", std::env::consts::EXE_SUFFIX));
        path.is_file().then_some(path)
    }

    #[test]
    fn bundled_typst_human_output_becomes_positioned_errors_with_excerpts() {
        let Some(typst) = bundled_typst() else {
            eprintln!("Typst sidecar is not staged; skipping the compile diagnostics check");
            return;
        };
        let directory = project(&[
            ("main.typ", "= Intro\n#include \"chapters/one.typ\"\n"),
            ("chapters/one.typ", "Text with $foo$ and @missing.\n"),
        ]);
        let root = directory.path();
        let capabilities = oleafly_core::typst_toolchain::capabilities_for(
            &oleafly_core::typst_toolchain::bundled_typst_version().to_string(),
        );
        let args = oleafly_core::typst_toolchain::typst_compile_args(
            capabilities,
            &root.join("main.typ"),
            &root.join("out.pdf"),
            root,
            oleafly_core::typst_toolchain::TypstDiagnosticFormat::Human,
            &[],
        )
        .unwrap();
        let mut command = std::process::Command::new(typst);
        command.args(args).current_dir(root);
        let output =
            crate::proc::output_contained_with_timeout(command, std::time::Duration::from_secs(60))
                .unwrap();
        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let mut errors = parse_typst_errors(&log);
        attach_typst_sources(root, root, &mut errors);
        let unknown = errors
            .iter()
            .find(|error| error.message == "unknown variable: foo")
            .unwrap_or_else(|| panic!("{log}"));
        assert_eq!(unknown.file.as_deref(), Some("chapters/one.typ"));
        assert_eq!(unknown.line, Some(1));
        assert_eq!((unknown.column, unknown.end_column), (Some(12), Some(15)));
        assert_eq!(
            unknown.source_line.as_deref(),
            Some("Text with $foo$ and @missing.")
        );
        assert!(!unknown.hints.is_empty(), "{log}");
        assert!(unknown.explanation.is_some());
    }

    #[test]
    fn structured_diagnostics_group_unresolved_labels_and_citations() {
        let errors = parse_typst_errors(
            "main.typ:1:4: error: label `<nolabel>` does not exist in the document\nmain.typ:2:1: error: citation key `knuth` is not present in the bibliography\nmain.typ:3:1: error: key `knuth` does not exist in the bibliography\nmain.typ:4:1: warning: unknown font family: x\nmain.typ:5:1: error: unknown variable: y\n",
        );
        let diagnostics = typst_log_diagnostics(&errors);
        let categories: Vec<_> = diagnostics
            .iter()
            .map(|diagnostic| diagnostic.category)
            .collect();
        assert_eq!(
            categories,
            [
                LogCategory::UndefinedReference,
                LogCategory::UndefinedCitation,
                LogCategory::UndefinedCitation,
                LogCategory::Error,
                LogCategory::PackageWarning,
            ]
        );
        assert_eq!(diagnostics[4].severity, LogSeverity::Warning);
        assert_eq!(diagnostics[0].file.as_deref(), Some("main.typ"));
        assert_eq!(diagnostics[0].line, Some(1));
    }
}
