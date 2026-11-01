use std::sync::LazyLock;

use crate::contact::contains_contact_token;
use crate::document_metadata::{find_document_metadata, parse_metadata_keys};
use crate::jsre::{JsMatch, JsRegex};
use crate::mask::mask_comments;
use crate::messages::{message, MessageRef};
use crate::msg;
use crate::resume::match_resume_section_heading;
use crate::standards::annotate;
use crate::text::{js_trim, lines_with_offsets, strip_one_each_end, utf16_len, SourceText};
use crate::types::{Certainty, Finding, FindingMethod, Lens, PreflightEngine, Severity};

fn make(
    id: &str,
    lens: Lens,
    severity: Severity,
    title: MessageRef,
    detail: MessageRef,
    range: Option<(usize, usize)>,
    certainty: Option<Certainty>,
) -> Finding {
    let mut finding = Finding::new(id, lens, severity, title, detail);
    if let Some((from, to)) = range {
        finding.from = Some(from);
        finding.to = Some(to);
    }
    finding.certainty = certainty;
    finding
}

macro_rules! regex {
    ($name:ident, $pattern:expr) => {
        static $name: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std($pattern));
    };
}

regex!(
    DOCUMENT_CLASS,
    r"\\documentclass\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}"
);
regex!(TWO_COLUMN_OPTION, r"(?-u:\b)twocolumn(?-u:\b)");
regex!(TWO_COLUMN_CLASS, r"(?i)(?-u:\b)(altacv|deedy)");
regex!(
    MULTICOL_PACKAGE,
    r"\\usepackage(?:\[[^\]]*\])?\{(?:multicol|paracol)\}"
);
regex!(MULTICOLS_ENVIRONMENT, r"\\begin\{multicols\}");
regex!(
    GLYPH_TO_UNICODE,
    r"\\pdfgentounicode|glyphtounicode|\\usepackage(?:\[[^\]]*\])?\{cmap\}"
);
regex!(ICON, r"\\fa[A-Za-z]");
regex!(TABULAR, r"\\begin\{(tabular\*?|tabularx)\}");
regex!(TIKZ, r"\\begin\{tikzpicture\}");
regex!(
    HEADER_MACRO,
    r"\\(?:fancyhead|fancyfoot|lhead|rhead|chead|lfoot|rfoot|cfoot)\s*(?:\[[^\]]*\])?\{([^}]*)\}"
);
regex!(
    INCLUDE_GRAPHICS,
    r"\\includegraphics\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}"
);
regex!(ALT_OPTION, r"(?-u:\b)alt\s*=\s*(\{[^}]*\}|[^,\]]*)");
regex!(HREF, r"\\href\s*\{[^}]*\}\s*\{([^}]*)\}");
regex!(URL_LABEL, r"(?i)^https?://");
regex!(
    METADATA_LANG,
    r"\\DocumentMetadata\s*\{[^}]*(?-u:\b)lang\s*="
);
regex!(PDF_LANG, r"pdflang\s*=");
regex!(
    LANGUAGE_PACKAGE,
    r"\\usepackage(?:\[[^\]]*\])?\{(?:babel|polyglossia)\}"
);
regex!(MAIN_LANGUAGE, r"\\setmainlanguage");
regex!(PDF_TITLE, r"pdftitle\s*=");
regex!(
    METADATA_TITLE,
    r"\\DocumentMetadata\s*\{[^}]*(?-u:\b)pdftitle\s*="
);
regex!(
    HEADING,
    r"\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\s*(?:\*\s*)?\{"
);
regex!(
    SECTION_TITLE,
    r"\\(?:section|subsection)\s*(?:\*\s*)?\{([^}]*)\}"
);
regex!(COLOR, r"\\(?:textcolor|color)\s*\{");
regex!(
    READING_ORDER,
    r"\\marginpar(?-u:\b)|\\begin\{wrapfigure\}|\\usepackage(?:\[[^\]]*\])?\{wrapfig\}"
);
regex!(UA_STANDARD, r"(?i)^\{?\s*ua");
regex!(DISPLAY_DOC_TITLE, r"(?i)pdfdisplaydoctitle\s*=\s*true");
regex!(
    MATH_ENVIRONMENT,
    r"\\begin\{(?:equation|align|gather|multline|eqnarray|math|displaymath)\*?\}"
);
regex!(INLINE_MATH, r"(?:^|[^\\$0-9A-Za-z_])\$[^$]+\$");
regex!(DISPLAY_MATH, r"\\\[");
regex!(
    HEADER_RULE,
    r"^\s*(?:\[[^\]]*\]\s*)?(?:\\hline|\\midrule|\\cline(?-u:\b))"
);
regex!(
    TABLE_ENVIRONMENT,
    r"\\begin\{(tabular\*?|tabularx|longtable)\}"
);

struct DocumentClass {
    opts: String,
    name: String,
    from: usize,
    to: usize,
}

fn document_class(text: &SourceText) -> Option<DocumentClass> {
    let found = DOCUMENT_CLASS.find_first(text)?;
    Some(DocumentClass {
        opts: found.text(text, 1).unwrap_or("").to_string(),
        name: js_trim(found.text(text, 2).unwrap_or("")).to_string(),
        from: found.from,
        to: found.to,
    })
}

fn span(found: &JsMatch) -> Option<(usize, usize)> {
    Some((found.from, found.to))
}

fn multi_column(text: &SourceText) -> Vec<Finding> {
    let dc = document_class(text);
    let two_column = dc
        .as_ref()
        .is_some_and(|dc| TWO_COLUMN_OPTION.is_match(&dc.opts));
    let two_column_class = dc
        .as_ref()
        .is_some_and(|dc| TWO_COLUMN_CLASS.is_match(&dc.name));
    if two_column || two_column_class {
        let range = dc.as_ref().map(|dc| (dc.from, dc.to));
        return vec![
            make(
                "multi-column",
                Lens::Ats,
                Severity::Info,
                message("rules.multi-column.titleTwoColumn"),
                message("rules.multi-column.detailTwoColumn"),
                range,
                None,
            ),
            make(
                "multi-column-reading-order-risk",
                Lens::A11y,
                Severity::Info,
                message("rules.multi-column-reading-order-risk.titleTwoColumn"),
                message("rules.multi-column-reading-order-risk.detailTwoColumn"),
                range,
                Some(Certainty::Advisory),
            ),
        ];
    }
    let hit = MULTICOL_PACKAGE
        .find_first(text)
        .or_else(|| MULTICOLS_ENVIRONMENT.find_first(text));
    match hit {
        Some(hit) => vec![
            make(
                "multi-column",
                Lens::Ats,
                Severity::Info,
                message("rules.multi-column.titleMultiColumn"),
                message("rules.multi-column.detailMultiColumn"),
                span(&hit),
                None,
            ),
            make(
                "multi-column-reading-order-risk",
                Lens::A11y,
                Severity::Info,
                message("rules.multi-column-reading-order-risk.titleMultiColumn"),
                message("rules.multi-column-reading-order-risk.detailMultiColumn"),
                span(&hit),
                Some(Certainty::Advisory),
            ),
        ],
        None => Vec::new(),
    }
}

fn no_glyph_to_unicode(text: &SourceText, engine: PreflightEngine) -> Vec<Finding> {
    if document_class(text).is_none() || GLYPH_TO_UNICODE.is_match(text.as_str()) {
        return Vec::new();
    }
    let engine_needs_map = matches!(engine, PreflightEngine::Bundled | PreflightEngine::Xelatex);
    vec![make(
        "no-glyphtounicode",
        Lens::Both,
        if engine_needs_map {
            Severity::Warning
        } else {
            Severity::Info
        },
        message("rules.no-glyphtounicode.title"),
        message(if engine_needs_map {
            "rules.no-glyphtounicode.detailEngineNeedsMap"
        } else {
            "rules.no-glyphtounicode.detailAutomatic"
        }),
        None,
        Some(Certainty::Advisory),
    )]
}

fn icon_near_contact(text: &SourceText) -> Vec<Finding> {
    let mut out = Vec::new();
    for (offset, line) in lines_with_offsets(text.as_str()) {
        let Some(icon) = ICON.first_str(line) else {
            continue;
        };
        if !contains_contact_token(line) {
            continue;
        }
        let from = offset + utf16_len(&line[..icon.start]);
        let to = offset + utf16_len(&line[..icon.end]);
        out.push(make(
            "icon-near-contact",
            Lens::Both,
            Severity::Warning,
            message("rules.icon-near-contact.title"),
            message("rules.icon-near-contact.detail"),
            Some((from, to)),
            Some(Certainty::Advisory),
        ));
    }
    out
}

fn layout_table(text: &SourceText) -> Vec<Finding> {
    let mut out = Vec::new();
    if let Some(tabular) = TABULAR.find_first(text) {
        out.push(make(
            "layout-table",
            Lens::Ats,
            Severity::Warning,
            message("rules.layout-table.titleTable"),
            message("rules.layout-table.detailTable"),
            span(&tabular),
            Some(Certainty::Advisory),
        ));
    }
    if let Some(tikz) = TIKZ.find_first(text) {
        out.push(make(
            "layout-table",
            Lens::Both,
            Severity::Warning,
            message("rules.layout-table.titleTikz"),
            message("rules.layout-table.detailTikz"),
            span(&tikz),
            Some(Certainty::Advisory),
        ));
    }
    out
}

fn contact_in_header(text: &SourceText) -> Vec<Finding> {
    HEADER_MACRO
        .find_all(text)
        .matches
        .into_iter()
        .filter(|found| contains_contact_token(found.text(text, 1).unwrap_or("")))
        .map(|found| {
            make(
                "contact-in-header",
                Lens::Ats,
                Severity::Warning,
                message("rules.contact-in-header.title"),
                message("rules.contact-in-header.detail"),
                span(&found),
                Some(Certainty::Advisory),
            )
        })
        .collect()
}

fn figure_alt(text: &SourceText) -> Vec<Finding> {
    let mut out = Vec::new();
    for found in INCLUDE_GRAPHICS.find_all(text).matches {
        let opts = found.text(text, 1).unwrap_or("");
        let file = js_trim(found.text(text, 2).unwrap_or(""));
        let alt = ALT_OPTION
            .first_str(opts)
            .and_then(|alt| alt.group(opts, 1))
            .map(|value| js_trim(strip_one_each_end(value, '{', '}')).to_string());
        let bad = match &alt {
            None => true,
            Some(alt) => alt.is_empty() || alt.to_lowercase() == file.to_lowercase(),
        };
        if bad {
            out.push(make(
                "figure-alt",
                Lens::A11y,
                Severity::Warning,
                message("rules.figure-alt.title"),
                message("rules.figure-alt.detail"),
                span(&found),
                None,
            ));
        }
    }
    out
}

const WEAK_LINK_TEXT: &[&str] = &[
    "click here",
    "here",
    "link",
    "this link",
    "this",
    "read more",
];

fn link_text(text: &SourceText) -> Vec<Finding> {
    let mut out = Vec::new();
    for found in HREF.find_all(text).matches {
        let label = js_trim(found.text(text, 1).unwrap_or(""));
        let weak =
            WEAK_LINK_TEXT.contains(&label.to_lowercase().as_str()) || URL_LABEL.is_match(label);
        if weak {
            out.push(make(
                "link-text",
                Lens::A11y,
                Severity::Warning,
                message("rules.link-text.title"),
                message("rules.link-text.detail"),
                span(&found),
                None,
            ));
        }
    }
    out
}

fn no_lang(text: &SourceText) -> Vec<Finding> {
    if document_class(text).is_none() {
        return Vec::new();
    }
    let source = text.as_str();
    let ok = METADATA_LANG.is_match(source)
        || PDF_LANG.is_match(source)
        || LANGUAGE_PACKAGE.is_match(source)
        || MAIN_LANGUAGE.is_match(source);
    if ok {
        return Vec::new();
    }
    vec![make(
        "no-lang",
        Lens::A11y,
        Severity::Warning,
        message("rules.no-lang.title"),
        message("rules.no-lang.detail"),
        None,
        None,
    )]
}

fn no_title(text: &SourceText) -> Vec<Finding> {
    if document_class(text).is_none() {
        return Vec::new();
    }
    if PDF_TITLE.is_match(text.as_str()) || METADATA_TITLE.is_match(text.as_str()) {
        return Vec::new();
    }
    vec![make(
        "no-title",
        Lens::A11y,
        Severity::Info,
        message("rules.no-title.title"),
        message("rules.no-title.detail"),
        None,
        None,
    )]
}

fn heading_level(name: &str) -> u32 {
    match name {
        "part" => 0,
        "chapter" => 1,
        "section" => 2,
        "subsection" => 3,
        "subsubsection" => 4,
        "paragraph" => 5,
        _ => 6,
    }
}

fn heading_skip(text: &SourceText) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut previous: Option<u32> = None;
    for found in HEADING.find_all(text).matches {
        let level = heading_level(found.text(text, 1).unwrap_or(""));
        if previous.is_some_and(|previous| level > previous + 1) {
            out.push(make(
                "heading-skip",
                Lens::Both,
                Severity::Warning,
                message("rules.heading-skip.title"),
                message("rules.heading-skip.detail"),
                span(&found),
                None,
            ));
        }
        previous = Some(level);
    }
    out
}

fn nonstandard_headings(text: &SourceText) -> Vec<Finding> {
    let titles: Vec<(String, usize, usize)> = SECTION_TITLE
        .find_all(text)
        .matches
        .into_iter()
        .map(|found| {
            (
                js_trim(found.text(text, 1).unwrap_or("")).to_string(),
                found.from,
                found.to,
            )
        })
        .collect();
    let looks_like_resume = titles
        .iter()
        .any(|(label, _, _)| match_resume_section_heading(label).is_some());
    if !looks_like_resume {
        return Vec::new();
    }
    titles
        .into_iter()
        .filter(|(label, _, _)| !label.is_empty() && match_resume_section_heading(label).is_none())
        .map(|(label, from, to)| {
            make(
                "nonstandard-headings",
                Lens::Ats,
                Severity::Info,
                msg!("rules.nonstandard-headings.title", "heading" => label),
                message("rules.nonstandard-headings.detail"),
                Some((from, to)),
                Some(Certainty::Advisory),
            )
        })
        .collect()
}

fn color_only(text: &SourceText) -> Vec<Finding> {
    match COLOR.find_first(text) {
        Some(found) => vec![make(
            "color-only",
            Lens::A11y,
            Severity::Info,
            message("rules.color-only.title"),
            message("rules.color-only.detail"),
            span(&found),
            Some(Certainty::Advisory),
        )],
        None => Vec::new(),
    }
}

fn reading_order_risk(text: &SourceText) -> Vec<Finding> {
    match READING_ORDER.find_first(text) {
        Some(found) => vec![make(
            "reading-order-risk",
            Lens::Both,
            Severity::Info,
            message("rules.reading-order-risk.title"),
            message("rules.reading-order-risk.detail"),
            span(&found),
            Some(Certainty::Advisory),
        )],
        None => Vec::new(),
    }
}

fn ua_standard_declaration(text: &SourceText) -> Option<(usize, usize)> {
    let metadata = find_document_metadata(text.as_str())?;
    let keys = parse_metadata_keys(&metadata.body);
    let standard = keys.map.get("pdfstandard")?;
    if standard.is_empty() || !UA_STANDARD.is_match(standard) {
        return None;
    }
    Some((metadata.start, metadata.end))
}

fn ua_standard_without_title(text: &SourceText) -> Vec<Finding> {
    let Some(range) = ua_standard_declaration(text) else {
        return Vec::new();
    };
    let has_title = PDF_TITLE.is_match(text.as_str());
    let shows_title = DISPLAY_DOC_TITLE.is_match(text.as_str());
    if has_title && shows_title {
        return Vec::new();
    }
    let detail = if !has_title && !shows_title {
        "rules.ua-standard-without-title.detailBoth"
    } else if has_title {
        "rules.ua-standard-without-title.detailDisplay"
    } else {
        "rules.ua-standard-without-title.detailTitle"
    };
    vec![make(
        "ua-standard-without-title",
        Lens::A11y,
        Severity::Warning,
        message("rules.ua-standard-without-title.title"),
        message(detail),
        Some(range),
        None,
    )]
}

// Math renders accessibly on the web only as MathML (or images with alt
// text). When the source contains math, point at the HTML export, which
// pandoc writes with --mathml, as an accessibility check surface.
fn math_ml_export_hint(text: &SourceText) -> Vec<Finding> {
    let source = text.as_str();
    let has_math = MATH_ENVIRONMENT.is_match(source)
        || INLINE_MATH.is_match(source)
        || DISPLAY_MATH.is_match(source);
    if !has_math {
        return Vec::new();
    }
    vec![make(
        "mathml-export-hint",
        Lens::A11y,
        Severity::Info,
        message("rules.mathml-export-hint.title"),
        message("rules.mathml-export-hint.detail"),
        None,
        Some(Certainty::Advisory),
    )]
}

fn ua_standard_on_bundled_engine(text: &SourceText, engine: PreflightEngine) -> Vec<Finding> {
    if engine != PreflightEngine::Bundled {
        return Vec::new();
    }
    let Some(range) = ua_standard_declaration(text) else {
        return Vec::new();
    };
    vec![make(
        "ua-standard-on-tectonic",
        Lens::A11y,
        Severity::Error,
        message("rules.ua-standard-on-tectonic.title"),
        message("rules.ua-standard-on-tectonic.detail"),
        Some(range),
        None,
    )]
}

fn table_header_rows(text: &SourceText) -> Vec<Finding> {
    let source = text.as_str();
    if source.contains("table/header-rows") {
        return Vec::new();
    }
    for found in TABLE_ENVIRONMENT.find_all(text).matches {
        let name = found.text(text, 1).unwrap_or("");
        let end_marker = format!("\\end{{{name}}}");
        let begin = found.bytes.start;
        let end = source[begin..].find(&end_marker).map(|at| begin + at);
        let body = &source[found.bytes.end..end.unwrap_or(source.len()).max(found.bytes.end)];
        let Some(first_row_end) = body.find("\\\\") else {
            continue;
        };
        let after_first_row = &body[first_row_end + 2..];
        let gap = match after_first_row.find("\\\\") {
            Some(next_row_end) => &after_first_row[..next_row_end],
            None => after_first_row,
        };
        if !HEADER_RULE.is_match(gap) {
            continue;
        }
        return vec![make(
            "table-header-rows",
            Lens::A11y,
            Severity::Warning,
            message("rules.table-header-rows.title"),
            message("rules.table-header-rows.detail"),
            span(&found),
            None,
        )];
    }
    Vec::new()
}

pub fn run_source_rules(text: &str, engine: PreflightEngine) -> Vec<Finding> {
    let masked = SourceText::new(mask_comments(text));
    let groups = [
        multi_column(&masked),
        no_glyph_to_unicode(&masked, engine),
        math_ml_export_hint(&masked),
        icon_near_contact(&masked),
        layout_table(&masked),
        contact_in_header(&masked),
        figure_alt(&masked),
        link_text(&masked),
        no_lang(&masked),
        no_title(&masked),
        heading_skip(&masked),
        nonstandard_headings(&masked),
        color_only(&masked),
        reading_order_risk(&masked),
        ua_standard_without_title(&masked),
        ua_standard_on_bundled_engine(&masked, engine),
        table_header_rows(&masked),
    ];
    let mut findings: Vec<Finding> = groups
        .into_iter()
        .flatten()
        .map(|finding| annotate(finding, FindingMethod::SourceHeuristic))
        .collect();
    findings.sort_by_key(|finding| finding.from.unwrap_or(0));
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offsets_after_an_emoji_are_utf16() {
        let found = run_source_rules("😀\n\\begin{tikzpicture}", PreflightEngine::Unknown);
        assert_eq!(
            found.iter().find(|f| f.id == "layout-table").unwrap().from,
            Some(3)
        );
    }

    #[test]
    fn findings_sort_by_offset_with_missing_offsets_first() {
        let text = "\\documentclass{article}\n\\begin{document}\n\\includegraphics{plot.png}\n";
        let found = run_source_rules(text, PreflightEngine::Unknown);
        let lang = found.iter().position(|f| f.id == "no-lang").unwrap();
        let figure = found.iter().position(|f| f.id == "figure-alt").unwrap();
        assert!(lang < figure);
        assert_eq!(found[figure].from, Some(41));
    }

    #[test]
    fn a_commented_package_raises_nothing() {
        let found = run_source_rules("% \\usepackage{multicol}\n", PreflightEngine::Unknown);
        assert!(found.iter().all(|f| f.id != "multi-column"));
    }

    #[test]
    fn alt_text_equal_to_the_file_name_is_weak() {
        let found = run_source_rules(
            "\\includegraphics[alt={plot.png}]{plot.png}\n\\includegraphics[alt=A chart]{b.png}",
            PreflightEngine::Unknown,
        );
        assert_eq!(found.iter().filter(|f| f.id == "figure-alt").count(), 1);
    }
}
