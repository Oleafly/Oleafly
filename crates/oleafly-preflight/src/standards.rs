//! Accessibility standard references (`packages/preflight/src/standards.ts`).

use std::collections::HashMap;
use std::sync::LazyLock;

use crate::types::{Finding, FindingMethod, Lens, StandardName, StandardRef};

const UA1_URL: &str = "https://pdfa.org/resource/iso-14289-pdfua/";
const UA2_URL: &str =
    "https://pdfa.org/iso-14289-2-pdf-ua-2-the-gold-standard-for-accessibility-in-pdf-2-0-has-arrived/";
const MATTERHORN_URL: &str =
    "https://pdfa.org/rules-for-accessible-pdf-matterhorn-protocol-1-1-is-now-available/";
const WCAG_PDF_TECHNIQUES_URL: &str = "https://www.w3.org/WAI/WCAG22/Techniques/#pdf";

fn ua1(clause: &str, label: &str, verapdf_rule: Option<&str>) -> StandardRef {
    StandardRef {
        standard: StandardName::PdfUa1,
        clause: clause.to_string(),
        label: Some(label.to_string()),
        technique: None,
        verapdf_rule: verapdf_rule.map(str::to_string),
        url: UA1_URL.to_string(),
    }
}

fn ua2(clause: &str, label: &str) -> StandardRef {
    StandardRef {
        standard: StandardName::PdfUa2,
        clause: clause.to_string(),
        label: Some(label.to_string()),
        technique: None,
        verapdf_rule: None,
        url: UA2_URL.to_string(),
    }
}

fn ua2_rule(clause: &str, label: &str, verapdf_rule: &str) -> StandardRef {
    StandardRef {
        verapdf_rule: Some(verapdf_rule.to_string()),
        ..ua2(clause, label)
    }
}

fn matterhorn(clause: &str, label: &str) -> StandardRef {
    StandardRef {
        standard: StandardName::Matterhorn11,
        clause: clause.to_string(),
        label: Some(label.to_string()),
        technique: None,
        verapdf_rule: None,
        url: MATTERHORN_URL.to_string(),
    }
}

fn wcag(clause: &str, label: &str, technique: Option<&str>) -> StandardRef {
    StandardRef {
        standard: StandardName::Wcag22,
        clause: clause.to_string(),
        label: Some(label.to_string()),
        technique: technique.map(str::to_string),
        verapdf_rule: None,
        url: match technique {
            Some(technique) => format!("https://www.w3.org/WAI/WCAG22/Techniques/pdf/{technique}"),
            None => WCAG_PDF_TECHNIQUES_URL.to_string(),
        },
    }
}

fn tagged_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.1", "Tagged PDF", Some("7.1-11")),
        ua1("6.2", "File format", Some("6.2-1")),
        ua2("8.2.1", "Structure"),
        matterhorn("01-005", "Tagged content"),
        wcag("1.3.1", "Info and Relationships", Some("PDF9")),
    ]
}

fn figure_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.3", "Graphics", Some("7.3-1")),
        ua2("8.2.5.28.2", "Figure"),
        matterhorn("13-004", "Alternative descriptions"),
        wcag("1.1.1", "Non-text Content", Some("PDF1")),
    ]
}

fn title_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.1", "Document title", Some("7.1-9")),
        ua2("8.11.1", "Metadata"),
        matterhorn("06-003", "Metadata"),
        wcag("2.4.2", "Page Titled", Some("PDF18")),
    ]
}

fn lang_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.2", "Text", Some("7.2-29")),
        ua2("8.4.4", "Natural language"),
        matterhorn("11-001", "Natural language"),
        wcag("3.1.1", "Language of Page", Some("PDF16")),
    ]
}

fn heading_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.4", "Headings", Some("7.4.2-1")),
        matterhorn("14-003", "Headings"),
        wcag("1.3.1", "Info and Relationships", Some("PDF9")),
        wcag("2.4.6", "Headings and Labels", None),
    ]
}

fn link_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.18.5", "Links", Some("7.18.5-2")),
        matterhorn("28-005", "Annotations"),
        wcag("2.4.4", "Link Purpose (In Context)", Some("PDF11")),
        wcag("2.4.4", "Link Purpose (In Context)", Some("PDF13")),
    ]
}

fn reading_order_refs() -> Vec<StandardRef> {
    vec![
        matterhorn("09", "Reading order"),
        wcag("1.3.2", "Meaningful Sequence", Some("PDF3")),
    ]
}

fn encoding_refs() -> Vec<StandardRef> {
    vec![
        ua1("7.21.7", "Character encoding", None),
        ua2("8.4.5.8", "Character encoding"),
        matterhorn("10-001", "Character encoding"),
        wcag("1.4.5", "Images of Text", Some("PDF7")),
    ]
}

pub struct StandardEntry {
    pub refs: Vec<StandardRef>,
    pub machine_checkable: bool,
}

fn machine(refs: Vec<StandardRef>) -> StandardEntry {
    StandardEntry {
        refs,
        machine_checkable: true,
    }
}

fn judgement(refs: Vec<StandardRef>) -> StandardEntry {
    StandardEntry {
        refs,
        machine_checkable: false,
    }
}

fn concat(parts: Vec<Vec<StandardRef>>) -> Vec<StandardRef> {
    parts.into_iter().flatten().collect()
}

/// The ids in `standards.ts`'s table, in its order.
pub const STANDARD_IDS: &[&str] = &[
    "pdf-untagged-output",
    "pdf-structure-missing",
    "pdf-structure-single-pass",
    "pdf-untagged-content",
    "pdf-suspects",
    "pdf-ua-claim-mismatch",
    "figure-alt",
    "output-figure-alt",
    "output-formula-alt",
    "output-table-headers",
    "table-header-rows",
    "heading-skip",
    "empty-heading",
    "output-heading-skip",
    "no-lang",
    "no-title",
    "pdf-xmp-title",
    "pdf-lang-title",
    "pdf-display-doc-title",
    "ua-standard-without-title",
    "ua-standard-on-tectonic",
    "pdf-link-alt",
    "link-text",
    "pdf-no-bookmarks",
    "pdf-reading-order",
    "reading-order-risk",
    "multi-column-reading-order-risk",
    "output-small-text",
    "color-only",
    "no-glyphtounicode",
    "pdf-garbled",
    "pdf-selectable",
    "icon-near-contact",
    "layout-table",
    "output-tagpdf-warning",
    "output-tagging-status",
    "pdf-metadata-extraction-failed",
    "pdf-mark-info-extraction-failed",
    "pdf-structure-extraction-failed",
];

static TABLE: LazyLock<HashMap<&str, StandardEntry>> = LazyLock::new(|| {
    let mut table = HashMap::new();
    table.insert("pdf-untagged-output", machine(tagged_refs()));
    table.insert("pdf-structure-missing", machine(tagged_refs()));
    table.insert(
        "pdf-structure-single-pass",
        machine(vec![
            ua1("7.1", "Tagged PDF", Some("7.1-11")),
            matterhorn("01-005", "Tagged content"),
        ]),
    );
    table.insert(
        "pdf-untagged-content",
        machine(vec![
            ua1("7.1", "Tagged PDF", Some("7.1-3")),
            ua2("8.2.2", "Real content"),
            matterhorn("01-005", "Tagged content"),
            wcag("1.3.1", "Info and Relationships", Some("PDF9")),
        ]),
    );
    table.insert(
        "pdf-suspects",
        machine(vec![
            ua1("7.1", "Tagged PDF", Some("7.1-4")),
            matterhorn("01", "Tagged content"),
        ]),
    );
    table.insert(
        "pdf-ua-claim-mismatch",
        machine(vec![
            ua1("5", "Conformance", Some("5-1")),
            ua1("5", "Conformance", Some("5-2")),
            ua2_rule("5", "Conformance", "5-5"),
            matterhorn("06-003", "Metadata"),
        ]),
    );
    table.insert("figure-alt", machine(figure_refs()));
    table.insert("output-figure-alt", machine(figure_refs()));
    table.insert(
        "output-formula-alt",
        machine(vec![
            ua1("7.7", "Mathematical expressions", None),
            ua2("8.2.5.29", "Formula"),
            matterhorn("17-002", "Mathematical expressions"),
            wcag("1.1.1", "Non-text Content", None),
        ]),
    );
    table.insert(
        "output-table-headers",
        machine(vec![
            ua1("7.5", "Tables", Some("7.5-1")),
            ua1("7.5", "Tables", Some("7.5-2")),
            matterhorn("15-003", "Tables"),
            wcag("1.3.1", "Info and Relationships", Some("PDF6")),
        ]),
    );
    table.insert(
        "table-header-rows",
        machine(vec![
            ua1("7.5", "Tables", Some("7.5-1")),
            matterhorn("15-003", "Tables"),
            wcag("1.3.1", "Info and Relationships", Some("PDF6")),
        ]),
    );
    table.insert("heading-skip", machine(heading_refs()));
    table.insert("empty-heading", machine(heading_refs()));
    table.insert("output-heading-skip", machine(heading_refs()));
    table.insert("no-lang", machine(lang_refs()));
    table.insert("no-title", machine(title_refs()));
    table.insert("pdf-xmp-title", machine(title_refs()));
    table.insert(
        "pdf-lang-title",
        machine(concat(vec![title_refs(), lang_refs()])),
    );
    table.insert(
        "pdf-display-doc-title",
        machine(vec![
            ua1("7.1", "Document title display", Some("7.1-10")),
            ua2("8.11.2", "Viewer preferences"),
            matterhorn("07-001", "Viewer preferences"),
            wcag("2.4.2", "Page Titled", Some("PDF18")),
        ]),
    );
    table.insert(
        "ua-standard-without-title",
        machine(concat(vec![
            title_refs(),
            vec![ua1("5", "Conformance", Some("5-1"))],
        ])),
    );
    table.insert(
        "ua-standard-on-tectonic",
        machine(concat(vec![
            vec![ua1("5", "Conformance", Some("5-1"))],
            tagged_refs(),
        ])),
    );
    table.insert("pdf-link-alt", machine(link_refs()));
    table.insert("link-text", judgement(link_refs()));
    table.insert(
        "pdf-no-bookmarks",
        machine(vec![wcag("2.4.5", "Multiple Ways", Some("PDF2"))]),
    );
    table.insert("pdf-reading-order", judgement(reading_order_refs()));
    table.insert("reading-order-risk", judgement(reading_order_refs()));
    table.insert(
        "multi-column-reading-order-risk",
        judgement(reading_order_refs()),
    );
    table.insert(
        "output-small-text",
        judgement(vec![
            matterhorn("04", "Colour and contrast"),
            wcag("1.4.3", "Contrast (Minimum)", None),
        ]),
    );
    table.insert(
        "color-only",
        judgement(vec![
            matterhorn("04", "Colour and contrast"),
            wcag("1.4.1", "Use of Color", None),
        ]),
    );
    table.insert("no-glyphtounicode", machine(encoding_refs()));
    table.insert("pdf-garbled", machine(encoding_refs()));
    table.insert("pdf-selectable", machine(encoding_refs()));
    table.insert(
        "icon-near-contact",
        judgement(vec![
            ua1("7.3", "Graphics", Some("7.3-1")),
            wcag("1.1.1", "Non-text Content", Some("PDF1")),
        ]),
    );
    table.insert(
        "layout-table",
        judgement(vec![
            ua1("7.3", "Graphics", Some("7.3-1")),
            wcag("1.1.1", "Non-text Content", Some("PDF1")),
        ]),
    );
    table.insert("output-tagpdf-warning", machine(tagged_refs()));
    table.insert("output-tagging-status", machine(tagged_refs()));
    table.insert(
        "pdf-metadata-extraction-failed",
        machine(vec![
            ua1("7.1", "Document title", Some("7.1-9")),
            ua1("7.2", "Text", Some("7.2-29")),
            matterhorn("06-003", "Metadata"),
            wcag("2.4.2", "Page Titled", Some("PDF18")),
        ]),
    );
    table.insert(
        "pdf-mark-info-extraction-failed",
        machine(vec![
            ua1("7.1", "Tagged PDF", Some("7.1-11")),
            ua1("7.1", "Tagged PDF", Some("7.1-4")),
            matterhorn("01-005", "Tagged content"),
        ]),
    );
    table.insert(
        "pdf-structure-extraction-failed",
        machine(vec![
            ua1("7.3", "Graphics", Some("7.3-1")),
            ua1("7.4", "Headings", Some("7.4.2-1")),
            ua1("7.5", "Tables", Some("7.5-1")),
            matterhorn("01-005", "Tagged content"),
        ]),
    );
    table
});

pub fn standard_entry(id: &str) -> Option<&'static StandardEntry> {
    TABLE.get(id)
}

pub fn standards_for(id: &str) -> Vec<StandardRef> {
    TABLE
        .get(id)
        .map(|entry| entry.refs.clone())
        .unwrap_or_default()
}

/// Adds the finding method, and for accessibility lenses the standards and
/// whether a machine can check them (`annotate` in `standards.ts`).
pub fn annotate(mut finding: Finding, method: FindingMethod) -> Finding {
    finding.method = Some(method);
    let carries_a11y = matches!(finding.lens, Lens::A11y | Lens::Both);
    if let (Some(entry), true) = (TABLE.get(finding.id.as_str()), carries_a11y) {
        if finding.standards.is_none() {
            finding.standards = Some(entry.refs.clone());
        }
        if finding.machine_checkable.is_none() {
            finding.machine_checkable = Some(entry.machine_checkable);
        }
    }
    finding
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::message;
    use crate::types::Severity;

    #[test]
    fn annotate_adds_standards_only_for_accessibility_lenses() {
        let figure = annotate(
            Finding::new(
                "figure-alt",
                Lens::A11y,
                Severity::Warning,
                message("rules.figure-alt.title"),
                message("rules.figure-alt.detail"),
            ),
            FindingMethod::SourceHeuristic,
        );
        assert_eq!(figure.machine_checkable, Some(true));
        assert_eq!(figure.standards.as_ref().map(Vec::len), Some(4));
        let reference = annotate(
            Finding::new(
                "refs-undefined-ref",
                Lens::Refs,
                Severity::Error,
                message("rules.refs-undefined-ref.title"),
                message("rules.refs-undefined-ref.detail"),
            ),
            FindingMethod::SourceHeuristic,
        );
        assert_eq!(reference.standards, None);
        assert_eq!(reference.method, Some(FindingMethod::SourceHeuristic));
    }

    #[test]
    fn every_listed_id_has_an_entry() {
        assert_eq!(STANDARD_IDS.len(), 39);
        for id in STANDARD_IDS {
            assert!(standard_entry(id).is_some(), "{id}");
        }
        assert_eq!(TABLE.len(), STANDARD_IDS.len());
    }
}
