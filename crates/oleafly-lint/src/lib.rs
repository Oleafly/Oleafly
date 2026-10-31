pub mod bibtex;
pub mod diagnostic;
pub mod latex;
pub mod messages;
pub mod proofread;
pub mod prose;
pub mod xparse;

pub use bibtex::lint_bibtex_text;
pub use diagnostic::{
    canonical_params, render, rule_id_for_key, FixSuggestion, LintDiagnostic, LintMessage,
    LintSource, SuggestionKind,
};
pub use latex::lint_latex_text;
pub use messages::editor_catalog;
pub use prose::{
    format_for_path, intersects_masked_region, prose_for, trim_to_letters, trim_to_word_characters,
    without_soft_hyphens, MaskSpan, ProseFormat, ProseInput, PROSE_PLACEHOLDER,
};
pub use xparse::validate_xparse_argument_specification;

fn has_extension(path: &str, extensions: &[&str]) -> bool {
    let Some((_, extension)) = path.rsplit_once('.') else {
        return false;
    };
    extensions
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
}

pub fn is_latex_source_path(path: &str) -> bool {
    has_extension(path, &["tex", "latex", "ltx", "sty", "cls"])
}

pub fn is_bibtex_source_path(path: &str) -> bool {
    has_extension(path, &["bib"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_paths_follow_the_editor() {
        assert!(is_latex_source_path("chapters/intro.TEX"));
        assert!(is_latex_source_path("style.sty"));
        assert!(!is_latex_source_path("notes.md"));
        assert!(is_bibtex_source_path("refs.BIB"));
        assert!(!is_bibtex_source_path("bib"));
    }
}
