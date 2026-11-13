use std::collections::HashSet;
use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::latex::lexical::latex_heading_title_brace;
use crate::resume::{is_ats_resume_section, match_resume_section_heading};
use crate::text::SourceText;

static RESUME_CLASS: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(concat!(
        r"(?i)\\documentclass(?:\[[^\]]{0,500}\])?\{\s{0,20}",
        r"(deedy[0-9A-Za-z_-]{0,50}|[0-9A-Za-z_-]{0,50}resume[0-9A-Za-z_-]{0,50}|[0-9A-Za-z_-]{0,50}cv)",
        r"\s{0,20}\}",
    ))
});

static SOURCE_HEADING: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"(?i)\\(?:section|subsection|cvsection|resumeSection)\*?\s*[\[{]")
});

static SOURCE_TITLE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^\{([^{}]{1,200})\}"));

pub fn looks_like_resume_source(text: &str) -> bool {
    if RESUME_CLASS.is_match(text) {
        return true;
    }
    let source = SourceText::new(text.to_string());
    let sections: HashSet<_> = SOURCE_HEADING
        .find_all(&source)
        .matches
        .iter()
        .filter_map(|found| {
            let open = latex_heading_title_brace(source.units(), found.to - 1)?;
            let rest = &source.as_str()[source.byte_at(open)..];
            SOURCE_TITLE.first_str(rest)?.group(rest, 1)
        })
        .map(match_resume_section_heading)
        .filter(|id| is_ats_resume_section(*id))
        .collect();
    sections.len() >= 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_classes_and_headings_mark_a_resume() {
        assert!(looks_like_resume_source(
            "\\documentclass{deedy-resume-openfont}"
        ));
        assert!(looks_like_resume_source(
            "\\section{Experience}\n\\section{Education}"
        ));
        assert!(!looks_like_resume_source(
            "\\documentclass{article}\n\\section{Introduction}"
        ));
    }
}
