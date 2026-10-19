//! Résumé section headings (`packages/preflight/src/resume-sections.ts`).

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::text::{is_js_space, is_letter_or_number, js_trim};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResumeSectionId {
    Experience,
    Education,
    Skills,
    Projects,
    Summary,
    Certifications,
    Awards,
    Publications,
    Activities,
    Interests,
    Contact,
    References,
    Leadership,
    Volunteer,
    Coursework,
    Achievements,
}

const PROJECT_PREFIXES: &[&str] = &[
    "personal",
    "academic",
    "selected",
    "key",
    "notable",
    "side",
    "technical",
    "relevant",
    "open source",
    "github",
    "software",
    "research",
    "engineering",
    "portfolio",
    "professional",
    "independent",
    "freelance",
    "capstone",
    "featured",
];

fn section_aliases() -> Vec<(ResumeSectionId, Vec<String>)> {
    let fixed = |names: &[&str]| {
        names
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>()
    };
    let mut projects = fixed(&["project", "projects"]);
    for prefix in PROJECT_PREFIXES {
        projects.push(format!("{prefix} project"));
        projects.push(format!("{prefix} projects"));
    }
    vec![
        (
            ResumeSectionId::Experience,
            fixed(&[
                "experience",
                "work experience",
                "professional experience",
                "relevant experience",
                "employment",
                "employment history",
            ]),
        ),
        (ResumeSectionId::Education, fixed(&["education"])),
        (
            ResumeSectionId::Skills,
            fixed(&[
                "skills",
                "technical skills",
                "core skills",
                "key skills",
                "technologies",
            ]),
        ),
        (ResumeSectionId::Projects, projects),
        (
            ResumeSectionId::Summary,
            fixed(&["summary", "objective", "profile", "about"]),
        ),
        (
            ResumeSectionId::Certifications,
            fixed(&["certification", "certifications"]),
        ),
        (
            ResumeSectionId::Awards,
            fixed(&["award", "awards", "honor", "honors", "honour", "honours"]),
        ),
        (
            ResumeSectionId::Publications,
            fixed(&["publication", "publications"]),
        ),
        (
            ResumeSectionId::Activities,
            fixed(&["activity", "activities"]),
        ),
        (
            ResumeSectionId::Interests,
            fixed(&["interest", "interests"]),
        ),
        (
            ResumeSectionId::Contact,
            fixed(&["contact", "contact information"]),
        ),
        (
            ResumeSectionId::References,
            fixed(&["reference", "references"]),
        ),
        (ResumeSectionId::Leadership, fixed(&["leadership"])),
        (
            ResumeSectionId::Volunteer,
            fixed(&["volunteer", "volunteering", "volunteer experience"]),
        ),
        (
            ResumeSectionId::Coursework,
            fixed(&["coursework", "relevant coursework"]),
        ),
        (
            ResumeSectionId::Achievements,
            fixed(&["achievement", "achievements"]),
        ),
    ]
}

/// NFKC, no NUL, whitespace collapsed and trimmed, lower case, and every run
/// of characters that is not a letter or a number removed.
pub fn normalize_resume_section_heading(value: &str) -> String {
    let normalized: String = value.nfkc().filter(|&ch| ch != '\0').collect();
    let mut collapsed = String::with_capacity(normalized.len());
    let mut in_space = false;
    for ch in normalized.chars() {
        if is_js_space(ch) {
            if !in_space {
                collapsed.push(' ');
            }
            in_space = true;
        } else {
            collapsed.push(ch);
            in_space = false;
        }
    }
    js_trim(&collapsed)
        .to_lowercase()
        .chars()
        .filter(|&ch| is_letter_or_number(ch))
        .collect()
}

static ALIAS_TO_SECTION: LazyLock<HashMap<String, ResumeSectionId>> = LazyLock::new(|| {
    let mut map = HashMap::new();
    for (id, aliases) in section_aliases() {
        for alias in aliases {
            let normalized = normalize_resume_section_heading(&alias);
            if let Some(previous) = map.insert(normalized, id) {
                assert!(previous == id, "Ambiguous resume section alias: {alias}");
            }
        }
    }
    map
});

pub fn match_resume_section_heading(value: &str) -> Option<ResumeSectionId> {
    let normalized = normalize_resume_section_heading(value);
    if normalized.is_empty() {
        return None;
    }
    ALIAS_TO_SECTION.get(&normalized).copied()
}

pub fn is_ats_resume_section(id: Option<ResumeSectionId>) -> bool {
    matches!(
        id,
        Some(
            ResumeSectionId::Experience
                | ResumeSectionId::Education
                | ResumeSectionId::Skills
                | ResumeSectionId::Projects
                | ResumeSectionId::Summary
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_alias_table_builds_without_ambiguity() {
        assert!(ALIAS_TO_SECTION.len() > 40);
    }

    #[test]
    fn headings_match_without_separators_or_case() {
        assert_eq!(
            match_resume_section_heading("GitHub Projects"),
            Some(ResumeSectionId::Projects)
        );
        assert_eq!(
            match_resume_section_heading("WORK-EXPERIENCE"),
            Some(ResumeSectionId::Experience)
        );
        assert_eq!(
            match_resume_section_heading("Projects I built at GitHub"),
            None
        );
        assert_eq!(match_resume_section_heading("  "), None);
    }
}
