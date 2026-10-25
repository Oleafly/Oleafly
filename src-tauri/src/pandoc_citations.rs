//! Citations in exports and bibliographies in imports live in
//! `oleafly_doctools::pandoc_citations` (shared with the CLI); this module
//! passes the app's home folder and turns failures into the app's errors.
use std::path::Path;

pub use oleafly_doctools::pandoc_citations::*;

/// The bibliographies `text` names (or the .bib files beside it), with
/// `~` meaning this user's home folder.
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

/// The export's pandoc failure as the app's error message.
pub(crate) fn export_failure(log: &str, root: &Path) -> String {
    let error = oleafly_doctools::pandoc_citations::export_failure(log, root);
    if error.code != "export.bibliography_unreadable" {
        return error.message;
    }
    let mut app = crate::app_error::AppError::new(error.code);
    for (key, value) in &error.params {
        app = if *key == "detail" {
            app.detail(value)
        } else {
            app.param(key, value)
        };
    }
    app.into()
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
        assert_eq!(export_failure("boom\n", root), "pandoc failed: boom");
    }
}
