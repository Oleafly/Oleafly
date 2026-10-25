//! Finding and report types, serialised exactly like `JSON.stringify` of the
//! TypeScript objects in `packages/preflight/src/types.ts`: absent optional
//! fields are omitted, `null` fields stay `null`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize, Serializer};

use crate::messages::MessageRef;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckId {
    Ats,
    Compile,
    A11y,
    Refs,
    Submission,
    Privacy,
}

/// `CHECK_IDS` in the TypeScript order.
pub const CHECK_IDS: [CheckId; 6] = [
    CheckId::Ats,
    CheckId::Compile,
    CheckId::A11y,
    CheckId::Refs,
    CheckId::Submission,
    CheckId::Privacy,
];

impl CheckId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ats => "ats",
            Self::Compile => "compile",
            Self::A11y => "a11y",
            Self::Refs => "refs",
            Self::Submission => "submission",
            Self::Privacy => "privacy",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lens {
    Ats,
    Compile,
    A11y,
    Refs,
    Submission,
    Privacy,
    Both,
}

impl Lens {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ats => "ats",
            Self::Compile => "compile",
            Self::A11y => "a11y",
            Self::Refs => "refs",
            Self::Submission => "submission",
            Self::Privacy => "privacy",
            Self::Both => "both",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Info => "info",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Certainty {
    Verified,
    Advisory,
    Manual,
}

impl Certainty {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::Advisory => "advisory",
            Self::Manual => "manual",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FindingMethod {
    PdfObjectModel,
    SourceHeuristic,
    CompileLog,
    LayoutHeuristic,
}

impl FindingMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PdfObjectModel => "pdf-object-model",
            Self::SourceHeuristic => "source-heuristic",
            Self::CompileLog => "compile-log",
            Self::LayoutHeuristic => "layout-heuristic",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    Evaluated,
    Partial,
    NotRun,
    Unsupported,
}

impl Coverage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Evaluated => "evaluated",
            Self::Partial => "partial",
            Self::NotRun => "not_run",
            Self::Unsupported => "unsupported",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreflightEngine {
    Bundled,
    Pdflatex,
    Lualatex,
    Xelatex,
    Typst,
    Unknown,
}

impl PreflightEngine {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::Pdflatex => "pdflatex",
            Self::Lualatex => "lualatex",
            Self::Xelatex => "xelatex",
            Self::Typst => "typst",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StandardName {
    #[serde(rename = "PDF/UA-1")]
    PdfUa1,
    #[serde(rename = "PDF/UA-2")]
    PdfUa2,
    #[serde(rename = "WCAG-2.2")]
    Wcag22,
    #[serde(rename = "Matterhorn-1.1")]
    Matterhorn11,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardRef {
    pub standard: StandardName,
    pub clause: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technique: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verapdf_rule: Option<String>,
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub lens: Lens,
    pub severity: Severity,
    pub title: MessageRef,
    pub detail: MessageRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail_parts: Option<Vec<MessageRef>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certainty: Option<Certainty>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub standards: Option<Vec<StandardRef>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<FindingMethod>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_checkable: Option<bool>,
}

impl Finding {
    /// A finding with only the fields every rule sets.
    pub fn new(
        id: &str,
        lens: Lens,
        severity: Severity,
        title: MessageRef,
        detail: MessageRef,
    ) -> Self {
        Self {
            id: id.to_string(),
            lens,
            severity,
            title,
            detail,
            detail_parts: None,
            from: None,
            to: None,
            page: None,
            file: None,
            certainty: None,
            standards: None,
            method: None,
            machine_checkable: None,
        }
    }

    pub fn with_range(mut self, from: usize, to: usize) -> Self {
        self.from = Some(from);
        self.to = Some(to);
        self
    }

    pub fn with_certainty(mut self, certainty: Certainty) -> Self {
        self.certainty = Some(certainty);
        self
    }

    pub fn with_file(mut self, file: impl Into<String>) -> Self {
        self.file = Some(file.into());
        self
    }
}

/// Scores and coverage per check, serialised in `CHECK_IDS` order (the
/// derived `Ord` of [`CheckId`] is that order).
pub type CheckScores = BTreeMap<CheckId, i64>;
pub type CheckCoverage = BTreeMap<CheckId, Coverage>;

/// Writes a JavaScript number: integral values without a fraction, like
/// `JSON.stringify(612)`.
pub fn serialize_js_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 9.007_199_254_740_992e15 {
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PdfPageFacts {
    #[serde(serialize_with = "serialize_js_number")]
    pub width: f64,
    #[serde(serialize_with = "serialize_js_number")]
    pub height: f64,
    pub rotation: i32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FontFact {
    pub name: String,
    pub embedded: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFacts {
    pub version: Option<String>,
    pub page_count: u32,
    pub pages: Vec<PdfPageFacts>,
    pub outline_count: u32,
    pub link_count: u32,
    pub attachment_count: u32,
    pub form_field_count: u32,
    pub restricted: Option<bool>,
    pub author: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub fonts: Vec<FontFact>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectFile {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub main_file: String,
    pub files: Vec<ProjectFile>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompileStatus {
    Idle,
    Success,
    Error,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileContext {
    pub status: CompileStatus,
    pub log: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub findings: Vec<Finding>,
    pub scores: CheckScores,
    pub ats_score: Option<i64>,
    pub compile_score: Option<i64>,
    pub a11y_score: Option<i64>,
    pub refs_score: Option<i64>,
    pub submission_score: Option<i64>,
    pub privacy_score: Option<i64>,
    pub coverage: CheckCoverage,
    pub has_pdf: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::message;

    #[test]
    fn finding_json_omits_absent_fields_like_json_stringify() {
        let finding = Finding::new(
            "no-lang",
            Lens::A11y,
            Severity::Warning,
            message("rules.no-lang.title"),
            message("rules.no-lang.detail"),
        );
        let json = serde_json::to_value(&finding).unwrap();
        let object = json.as_object().unwrap();
        for absent in [
            "from",
            "to",
            "file",
            "params",
            "certainty",
            "standards",
            "method",
        ] {
            assert!(!object.contains_key(absent), "{absent}");
        }
        assert!(!object["title"].as_object().unwrap().contains_key("params"));
        assert_eq!(object["lens"], "a11y");
    }

    #[test]
    fn scores_serialise_in_check_order() {
        let mut scores = CheckScores::new();
        for (index, id) in CHECK_IDS.iter().rev().enumerate() {
            scores.insert(*id, index as i64);
        }
        let text = serde_json::to_string(&scores).unwrap();
        assert!(text.starts_with("{\"ats\":"));
        assert!(text.ends_with("\"privacy\":0}"));
    }

    #[test]
    fn page_sizes_serialise_as_javascript_numbers() {
        let page = PdfPageFacts {
            width: 612.0,
            height: 841.9,
            rotation: 0,
        };
        assert_eq!(
            serde_json::to_value(page).unwrap(),
            serde_json::json!({ "width": 612, "height": 841.9, "rotation": 0 })
        );
    }
}
