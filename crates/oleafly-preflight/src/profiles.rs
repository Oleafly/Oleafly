//! Submission profiles (`packages/preflight/src/profiles.ts`).

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::jsre::JsRegex;
use crate::text::{is_js_space, js_trim};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubmissionProfileId {
    Generic,
    Arxiv,
    Ieee,
    Acm,
    Journal,
    Thesis,
}

pub const SUBMISSION_PROFILE_IDS: [SubmissionProfileId; 6] = [
    SubmissionProfileId::Generic,
    SubmissionProfileId::Arxiv,
    SubmissionProfileId::Ieee,
    SubmissionProfileId::Acm,
    SubmissionProfileId::Journal,
    SubmissionProfileId::Thesis,
];

impl SubmissionProfileId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Generic => "generic",
            Self::Arxiv => "arxiv",
            Self::Ieee => "ieee",
            Self::Acm => "acm",
            Self::Journal => "journal",
            Self::Thesis => "thesis",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        SUBMISSION_PROFILE_IDS
            .into_iter()
            .find(|id| id.as_str() == value)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRequirements {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub portable_file_names: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exact_case_paths: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_figure_extensions: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_document_classes: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_typst_templates: Option<&'static [&'static str]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_abstract: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_keywords: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfRequirements {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_version: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub require_embedded_fonts: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbid_bookmarks: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbid_links: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbid_attachments: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forbid_restrictions: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SubmissionProfile {
    pub id: SubmissionProfileId,
    pub label: &'static str,
    pub description: &'static str,
    pub source: SourceRequirements,
    pub pdf: PdfRequirements,
}

const IEEE_TEMPLATES: &[&str] = &["charged-ieee", "bamdone-ieeeconf", "tatras-ieee"];
const ACM_TEMPLATES: &[&str] = &["clean-acmart", "faithful-acmart", "approximate-acmsmall"];

static PROFILES: LazyLock<Vec<SubmissionProfile>> = LazyLock::new(|| {
    vec![
        SubmissionProfile {
            id: SubmissionProfileId::Generic,
            label: "General publication",
            description:
                "Portable source, clean output, complete metadata, and common publication risks.",
            source: SourceRequirements {
                exact_case_paths: Some(true),
                require_abstract: Some(true),
                ..SourceRequirements::default()
            },
            pdf: PdfRequirements::default(),
        },
        SubmissionProfile {
            id: SubmissionProfileId::Arxiv,
            label: "arXiv",
            description:
                "Portable source that can be rebuilt on arXiv's case-sensitive submission system.",
            source: SourceRequirements {
                portable_file_names: Some(true),
                exact_case_paths: Some(true),
                allowed_figure_extensions: Some(&[
                    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".ps", ".eps",
                ]),
                require_abstract: Some(true),
                ..SourceRequirements::default()
            },
            pdf: PdfRequirements::default(),
        },
        SubmissionProfile {
            id: SubmissionProfileId::Ieee,
            label: "IEEE conference / journal",
            description:
                "IEEEtran source plus the PDF constraints checked for IEEE Xplore publication.",
            source: SourceRequirements {
                exact_case_paths: Some(true),
                recommended_document_classes: Some(&["IEEEtran"]),
                recommended_typst_templates: Some(IEEE_TEMPLATES),
                require_abstract: Some(true),
                require_keywords: Some(true),
                ..SourceRequirements::default()
            },
            pdf: PdfRequirements {
                minimum_version: Some("1.4"),
                require_embedded_fonts: Some(true),
                forbid_bookmarks: Some(true),
                forbid_links: Some(true),
                forbid_attachments: Some(true),
                forbid_restrictions: Some(true),
            },
        },
        SubmissionProfile {
            id: SubmissionProfileId::Acm,
            label: "ACM conference / journal",
            description: "ACM acmart source structure and publication-ready research metadata.",
            source: SourceRequirements {
                exact_case_paths: Some(true),
                recommended_document_classes: Some(&["acmart"]),
                recommended_typst_templates: Some(ACM_TEMPLATES),
                require_abstract: Some(true),
                require_keywords: Some(true),
                ..SourceRequirements::default()
            },
            pdf: PdfRequirements {
                require_embedded_fonts: Some(true),
                ..PdfRequirements::default()
            },
        },
        SubmissionProfile {
            id: SubmissionProfileId::Journal,
            label: "Other journal",
            description:
                "Publisher-neutral journal checks. Add the journal's exact limits before submission.",
            source: SourceRequirements {
                exact_case_paths: Some(true),
                require_abstract: Some(true),
                ..SourceRequirements::default()
            },
            pdf: PdfRequirements::default(),
        },
        SubmissionProfile {
            id: SubmissionProfileId::Thesis,
            label: "Thesis / dissertation",
            description:
                "Long-document structure, navigation, references, and portable source checks.",
            source: SourceRequirements {
                exact_case_paths: Some(true),
                require_abstract: Some(true),
                ..SourceRequirements::default()
            },
            pdf: PdfRequirements::default(),
        },
    ]
});

pub fn submission_profile(id: SubmissionProfileId) -> &'static SubmissionProfile {
    PROFILES
        .iter()
        .find(|profile| profile.id == id)
        .unwrap_or(&PROFILES[0])
}

pub fn submission_profiles() -> &'static [SubmissionProfile] {
    &PROFILES
}

fn skip_whitespace(source: &str, from: usize) -> usize {
    let mut cursor = from;
    while let Some(ch) = source[cursor..].chars().next() {
        if !is_js_space(ch) {
            break;
        }
        cursor += ch.len_utf8();
    }
    cursor
}

fn skip_class_options(source: &str, from: usize) -> Option<usize> {
    if !source[from..].starts_with('[') {
        return Some(from);
    }
    let options_end = source[from + 1..].find(']')? + from + 1;
    Some(skip_whitespace(source, options_end + 1))
}

/// The `\documentclass` name, skipping options (`extractDocumentClass`).
pub fn extract_document_class(source: &str) -> Option<String> {
    const COMMAND: &str = "\\documentclass";
    let mut search_from = 0;
    while search_from < source.len() {
        let command_at = source[search_from..].find(COMMAND)? + search_from;
        let cursor =
            skip_class_options(source, skip_whitespace(source, command_at + COMMAND.len()))?;
        if source[cursor..].starts_with('{') {
            let class_end = source[cursor + 1..].find('}')? + cursor + 1;
            let name = js_trim(&source[cursor + 1..class_end]);
            return (!name.is_empty()).then(|| name.to_string());
        }
        search_from = command_at + COMMAND.len();
    }
    None
}

static TYPST_TEMPLATE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r#"(?m)^[ \t]*#import\s+"@[a-z0-9-]+/([a-z0-9-]+):"#));

/// Package names from `#import "@namespace/name:version"` lines.
pub fn extract_typst_templates(source: &str) -> Vec<String> {
    TYPST_TEMPLATE
        .captures_str(source)
        .0
        .iter()
        .filter_map(|found| found.group(source, 1).map(str::to_string))
        .collect()
}

static THESIS_TEMPLATE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std("thesis|dissertation"));
static THESIS_CLASS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std("(?:thesis|dissertation|memoir|book)"));

fn typst_profile(source: &str) -> Option<SubmissionProfileId> {
    for template in extract_typst_templates(source) {
        for id in [SubmissionProfileId::Ieee, SubmissionProfileId::Acm] {
            let templates = submission_profile(id).source.recommended_typst_templates;
            if templates.is_some_and(|names| names.contains(&template.as_str())) {
                return Some(id);
            }
        }
        if THESIS_TEMPLATE.is_match(&template) {
            return Some(SubmissionProfileId::Thesis);
        }
    }
    None
}

pub fn detect_submission_profile(source: &str) -> SubmissionProfileId {
    if let Some(profile) = typst_profile(source) {
        return profile;
    }
    let class_name = extract_document_class(source).map(|name| name.to_lowercase());
    match class_name.as_deref() {
        Some("ieeetran") => SubmissionProfileId::Ieee,
        Some("acmart") => SubmissionProfileId::Acm,
        Some(name) if THESIS_CLASS.is_match(name) => SubmissionProfileId::Thesis,
        _ => SubmissionProfileId::Generic,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_profiles_from_classes_and_templates() {
        assert_eq!(
            detect_submission_profile("\\documentclass[conference]{IEEEtran}"),
            SubmissionProfileId::Ieee
        );
        assert_eq!(
            detect_submission_profile("#import \"@preview/charged-ieee:0.1.0\": ieee"),
            SubmissionProfileId::Ieee
        );
        assert_eq!(
            detect_submission_profile("\\documentclass{memoir}"),
            SubmissionProfileId::Thesis
        );
        assert_eq!(
            detect_submission_profile("plain"),
            SubmissionProfileId::Generic
        );
    }

    #[test]
    fn document_class_skips_options_and_requires_a_brace() {
        assert_eq!(
            extract_document_class("\\documentclass [a4paper] { article }").as_deref(),
            Some("article")
        );
        assert_eq!(extract_document_class("\\documentclass[x{y}"), None);
        assert_eq!(extract_document_class("\\documentclass{  }"), None);
    }
}
