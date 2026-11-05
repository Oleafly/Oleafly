use std::path::Path;

pub use oleafly_doctools::pandoc_citations::*;

pub(crate) fn collect_import_bibliographies(
    source: BibliographySource,
    source_path: &Path,
    text: &str,
) -> ImportBibliographies {
    let home = crate::paths::home_dir().ok();
    oleafly_doctools::pandoc_citations::collect_import_bibliographies(
        source,
        source_path,
        text,
        home.as_deref(),
    )
}

pub(crate) fn coded_export_error(error: &oleafly_doctools::DocError) -> String {
    let unnamed = error.code == "doc.failed";
    if unnamed && crate::app_error::english(&error.message).is_some() {
        return error.message.clone();
    }
    let code = if unnamed { "export.failed" } else { error.code };
    let mut app = crate::app_error::AppError::new(code);
    for (key, value) in &error.params {
        app = if *key == "detail" {
            app.detail(value)
        } else {
            app.param(key, value)
        };
    }
    if unnamed {
        app = app.detail(&error.message);
    }
    app.into()
}

pub(crate) fn export_failure(log: &str, root: &Path) -> String {
    coded_export_error(&oleafly_doctools::pandoc_citations::export_failure(
        log, root,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_bibliographies_become_app_errors() {
        let root = Path::new("/home/ada/project");
        let error = export_failure(
            "Error reading bibliography file /home/ada/project/paper/refs.bib:\n(line 2, column 1):\nunexpected end of input\n",
            root,
        );
        assert_eq!(
            crate::app_error::english(&error).as_deref(),
            Some("Oleafly couldn't read the bibliography paper/refs.bib. Check it for a broken entry, then export again. (line 2, column 1: unexpected end of input)")
        );
        assert_eq!(
            crate::app_error::english(&export_failure("boom\n", root)).as_deref(),
            Some("Pandoc couldn't export the document. (boom)")
        );
    }

    #[test]
    fn every_export_failure_reaches_the_ui_with_its_code() {
        let root = Path::new("/home/ada/project");
        for (log, code) in [
            ("boom\n", "export.failed"),
            (
                "File figures/a.png not found in resource path\n",
                "export.image_missing",
            ),
        ] {
            assert_eq!(
                crate::app_error::code(&export_failure(log, root)).as_deref(),
                Some(code),
                "{log}"
            );
        }
        for (error, english) in [
            (
                oleafly_doctools::DocError::new("export.inside_project", "x"),
                "Choose an export destination outside this project.",
            ),
            (
                oleafly_doctools::DocError::new("export.unsupported_format", "x")
                    .param("format", "odt"),
                "Oleafly can't export to odt.",
            ),
            (
                oleafly_doctools::DocError::other("disk full"),
                "Pandoc couldn't export the document. (disk full)",
            ),
        ] {
            assert_eq!(
                crate::app_error::english(&coded_export_error(&error)).as_deref(),
                Some(english)
            );
        }
    }

    #[test]
    fn a_tool_that_could_not_start_keeps_its_own_code() {
        let coded = String::from(
            crate::app_error::AppError::new("compile.tool_blocked")
                .param("tool", "pandoc")
                .detail("Access is denied. (os error 5)"),
        );
        let exported = coded_export_error(&oleafly_doctools::DocError::other(coded.clone()));
        assert_eq!(exported, coded);
        assert_eq!(
            crate::app_error::code(&exported).as_deref(),
            Some("compile.tool_blocked")
        );
    }
}
