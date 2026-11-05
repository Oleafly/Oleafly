use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::typst_toolchain::ToolchainVersion;

pub const TYPST_HTML_MATH_SINCE: (u64, u64) = (0, 15);
pub const TYPST_HTML_FOOTNOTES_SINCE: (u64, u64) = (0, 14);

const CELLS_HELPER: &str = r#"#let oleafly-cells(items) = items.map(cell => {
  if type(cell) != content { none }
  else if cell.func() == grid.cell { cell.body }
  else if cell.func() in (grid.header, grid.footer) { oleafly-cells(cell.children) }
  else if cell.func() in (grid.hline, grid.vline) { none }
  else { cell }
}).filter(item => item != none).join(parbreak())
"#;
const BODY_ELEMENTS: [&str; 12] = [
    "align", "pad", "columns", "rect", "square", "circle", "ellipse", "place", "rotate", "scale",
    "skew", "move",
];
const CHILD_ELEMENTS: [&str; 2] = ["grid", "stack"];
const HARMLESS_ELEMENTS: [&str; 10] = [
    "page set rule",
    "pagebreak",
    "colbreak",
    "v",
    "h",
    "flush",
    "line",
    "hide",
    "repeat",
    "pdf-marker-tag",
];
const OUTDATED_ELEMENTS: [&str; 4] = ["equation", "block", "inline", FOOTNOTE_ELEMENT];
const FOOTNOTE_ELEMENT: &str = "footnote";
const FOOTNOTE_SPACING: &str = "h";
const WARNING_PREFIX: &str = "warning: ";
const IGNORED_SUFFIX: &str = " was ignored during HTML export";

static NOTE_REFERENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r##"<sup((?: [a-z-]+="[^"]*")*?) role="doc-noteref"((?: [a-z-]+="[^"]*")*)><a href="(#[^"]*)">([^<]*)</a></sup>"##,
    )
    .expect("the note reference pattern is valid")
});
static NOTE_BACKLINK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r##"<sup role="doc-backlink"><a href="#[^"]*">[^<]*</a></sup>"##)
        .expect("the note backlink pattern is valid")
});

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypstHtmlNotes {
    pub skipped: Vec<String>,
    pub outdated_typst: Option<String>,
    pub read_from_source: Option<String>,
}

fn html_only_show_rule(element: &str, content: &str) -> String {
    format!(
        "#show {element}: it => context if target() == \"html\" {{ {content} }} else {{ it }}\n"
    )
}

pub fn html_entry_source(main_doc: &str) -> String {
    let mut source = String::from(CELLS_HELPER);
    for element in BODY_ELEMENTS {
        source.push_str(&html_only_show_rule(element, "it.body"));
    }
    for element in CHILD_ELEMENTS {
        source.push_str(&html_only_show_rule(element, "oleafly-cells(it.children)"));
    }
    let path = main_doc.replace('\\', "/");
    let path = path.trim_start_matches("./").trim_start_matches('/');
    source.push_str("#include \"/");
    source.push_str(&path.replace('"', "\\\""));
    source.push_str("\"\n");
    source
}

pub fn footnotes_for_pandoc(html: &str) -> String {
    let references =
        NOTE_REFERENCE.replace_all(html, r#"<a$1$2 role="doc-noteref" href="$3">$4</a>"#);
    NOTE_BACKLINK.replace_all(&references, "").into_owned()
}

fn ignored_elements(log: &str) -> impl Iterator<Item = &str> {
    log.lines().filter_map(|line| {
        line.trim()
            .strip_prefix(WARNING_PREFIX)
            .and_then(|line| line.strip_suffix(IGNORED_SUFFIX))
    })
}

pub fn skipped_html_elements(log: &str) -> Vec<String> {
    let mut skipped: Vec<String> = Vec::new();
    for element in ignored_elements(log) {
        if !HARMLESS_ELEMENTS.contains(&element) && !skipped.iter().any(|known| known == element) {
            skipped.push(element.to_owned());
        }
    }
    skipped
}

pub fn typst_html_keeps_math(version: &ToolchainVersion) -> bool {
    (version.major, version.minor) >= TYPST_HTML_MATH_SINCE
}

pub fn typst_html_keeps_footnotes(version: &ToolchainVersion) -> bool {
    (version.major, version.minor) >= TYPST_HTML_FOOTNOTES_SINCE
}

pub fn html_export_notes(version: &ToolchainVersion, log: &str) -> TypstHtmlNotes {
    let mut skipped = skipped_html_elements(log);
    if !typst_html_keeps_footnotes(version)
        && ignored_elements(log).any(|element| element == FOOTNOTE_SPACING)
    {
        skipped.push(FOOTNOTE_ELEMENT.to_owned());
    }
    let outdated_typst = (!typst_html_keeps_math(version)
        && skipped
            .iter()
            .any(|element| OUTDATED_ELEMENTS.contains(&element.as_str())))
    .then(|| version.to_string());
    TypstHtmlNotes {
        skipped,
        outdated_typst,
        read_from_source: None,
    }
}

pub fn html_lost_content(version: &ToolchainVersion, notes: &TypstHtmlNotes) -> bool {
    !typst_html_keeps_math(version) && !notes.skipped.is_empty()
}

pub fn notes_for_source_read(version: &ToolchainVersion) -> TypstHtmlNotes {
    TypstHtmlNotes {
        read_from_source: Some(version.to_string()),
        ..TypstHtmlNotes::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(text: &str) -> ToolchainVersion {
        ToolchainVersion::parse(text).unwrap()
    }

    #[test]
    fn the_entry_includes_the_main_document_from_the_project_root() {
        let source = html_entry_source("main.typ");
        assert!(source.ends_with("#include \"/main.typ\"\n"), "{source}");
        for element in BODY_ELEMENTS {
            assert!(
                source.contains(&format!(
                    "#show {element}: it => context if target() == \"html\" {{ it.body }} else {{ it }}\n"
                )),
                "{element}"
            );
        }
        for element in CHILD_ELEMENTS {
            assert!(
                source.contains(&format!(
                    "#show {element}: it => context if target() == \"html\" {{ oleafly-cells(it.children) }} else {{ it }}\n"
                )),
                "{element}"
            );
        }
        assert!(!source.contains("#show hide"));
        assert!(!source.contains("#show repeat"));
    }

    #[test]
    fn entry_paths_use_forward_slashes_and_escape_quotes() {
        for (main_doc, include) in [
            ("sub/main.typ", "#include \"/sub/main.typ\"\n"),
            ("sub\\main.typ", "#include \"/sub/main.typ\"\n"),
            ("./main.typ", "#include \"/main.typ\"\n"),
            ("/main.typ", "#include \"/main.typ\"\n"),
            (
                "notes/my \"best\" 논문.typ",
                "#include \"/notes/my \\\"best\\\" 논문.typ\"\n",
            ),
        ] {
            let source = html_entry_source(main_doc);
            assert!(source.ends_with(include), "{main_doc}: {source}");
        }
    }

    #[test]
    fn footnotes_become_links_pandoc_recognises() {
        let html = concat!(
            r##"<p>Text<sup id="loc-2" role="doc-noteref"><a href="#loc-7">1</a></sup>.</p>"##,
            r##"<section role="doc-endnotes"><ol><li id="loc-7">"##,
            r##"<sup role="doc-backlink"><a href="#loc-2">1</a></sup>Note</li></ol></section>"##
        );
        let rewritten = footnotes_for_pandoc(html);
        assert!(
            rewritten.contains(r##"<a id="loc-2" role="doc-noteref" href="#loc-7">1</a>"##),
            "{rewritten}"
        );
        assert!(!rewritten.contains("<sup"), "{rewritten}");
        assert!(
            rewritten.contains(r#"<li id="loc-7">Note</li>"#),
            "{rewritten}"
        );
    }

    #[test]
    fn footnote_rewriting_leaves_other_markup_alone() {
        let older = concat!(
            r##"<a id="loc-2" href="#loc-7" role="doc-noteref"><sup>1</sup></a>"##,
            r##"<li id="loc-7"><a href="#loc-2" role="doc-backlink"><sup>1</sup></a>Note</li>"##,
            "<sup>2</sup>"
        );
        assert_eq!(footnotes_for_pandoc(older), older);
        let once =
            footnotes_for_pandoc(r##"<sup id="a" role="doc-noteref"><a href="#b">3</a></sup>"##);
        assert_eq!(footnotes_for_pandoc(&once), once);
    }

    #[test]
    fn a_reference_without_an_id_still_converts() {
        assert_eq!(
            footnotes_for_pandoc(r##"<sup role="doc-noteref"><a href="#b">3</a></sup>"##),
            r##"<a role="doc-noteref" href="#b">3</a>"##
        );
    }

    #[test]
    fn only_lost_content_counts_as_skipped() {
        let log = "warning: html export is under active development and incomplete\n = hint: its behaviour may change at any time\n\nwarning: page set rule was ignored during HTML export\n  ┌─ main.typ:2:1\n\nwarning: layout was ignored during HTML export\nwarning: curve was ignored during HTML export\nwarning: layout was ignored during HTML export\nwarning: pagebreak was ignored during HTML export\nwarning: colbreak was ignored during HTML export\nwarning: h was ignored during HTML export\nwarning: v was ignored during HTML export\nwarning: line was ignored during HTML export\nwarning: hide was ignored during HTML export\nwarning: repeat was ignored during HTML export\nwarning: flush was ignored during HTML export\nwarning: pdf-marker-tag was ignored during HTML export\nerror: layout was ignored during HTML export\nlayout was ignored during HTML export\n";
        assert_eq!(skipped_html_elements(log), ["layout", "curve"]);
        assert!(skipped_html_elements("").is_empty());
    }

    #[test]
    fn versions_before_the_math_writer_lose_content_when_typst_says_so() {
        let math = "warning: equation was ignored during HTML export\n";
        let block = "warning: block was ignored during HTML export\nwarning: inline was ignored during HTML export\n";
        let layout = "warning: layout was ignored during HTML export\n";
        let page = "warning: page set rule was ignored during HTML export\n";

        let old = html_export_notes(&version("0.14.2"), math);
        assert_eq!(old.skipped, ["equation"]);
        assert_eq!(old.outdated_typst.as_deref(), Some("0.14.2"));

        let oldest = html_export_notes(&version("0.13.1"), block);
        assert_eq!(oldest.skipped, ["block", "inline"]);
        assert_eq!(oldest.outdated_typst.as_deref(), Some("0.13.1"));

        assert_eq!(
            html_export_notes(&version("0.14.2"), page),
            TypstHtmlNotes::default()
        );

        let current = html_export_notes(&version("0.15.1"), layout);
        assert_eq!(current.skipped, ["layout"]);
        assert_eq!(current.outdated_typst, None);

        assert!(typst_html_keeps_math(&version("0.15.0")));
        assert!(typst_html_keeps_math(&version("1.0.0")));
        assert!(!typst_html_keeps_math(&version("0.14.2")));
    }

    #[test]
    fn footnotes_vanish_before_0_14_with_only_a_spacing_warning() {
        let log = "warning: h was ignored during HTML export\n";
        let lost = html_export_notes(&version("0.13.1"), log);
        assert_eq!(lost.skipped, ["footnote"]);
        assert_eq!(lost.outdated_typst.as_deref(), Some("0.13.1"));
        assert!(html_lost_content(&version("0.13.1"), &lost));

        let kept = html_export_notes(&version("0.14.2"), log);
        assert_eq!(kept, TypstHtmlNotes::default());
        assert!(!html_lost_content(&version("0.14.2"), &kept));

        assert!(!typst_html_keeps_footnotes(&version("0.13.1")));
        assert!(typst_html_keeps_footnotes(&version("0.14.0")));
    }

    #[test]
    fn only_lost_equations_images_and_notes_blame_the_typst_version() {
        let layout = "warning: layout was ignored during HTML export\nwarning: curve was ignored during HTML export\n";
        let notes = html_export_notes(&version("0.14.2"), layout);
        assert_eq!(notes.skipped, ["layout", "curve"]);
        assert_eq!(notes.outdated_typst, None);
        assert!(html_lost_content(&version("0.14.2"), &notes));

        let current = html_export_notes(&version("0.15.1"), layout);
        assert_eq!(current.outdated_typst, None);
        assert!(!html_lost_content(&version("0.15.1"), &current));

        let image = "warning: block was ignored during HTML export\n";
        let notes = html_export_notes(&version("0.13.1"), image);
        assert_eq!(notes.outdated_typst.as_deref(), Some("0.13.1"));
        assert!(html_lost_content(&version("0.13.1"), &notes));
    }

    #[test]
    fn a_source_read_carries_only_its_version() {
        assert_eq!(
            notes_for_source_read(&version("0.14.2")),
            TypstHtmlNotes {
                read_from_source: Some("0.14.2".into()),
                ..TypstHtmlNotes::default()
            }
        );
    }

    #[test]
    fn notes_reach_the_app_in_camel_case() {
        let notes = TypstHtmlNotes {
            skipped: vec!["layout".into()],
            outdated_typst: Some("0.14.2".into()),
            read_from_source: Some("0.13.1".into()),
        };
        assert_eq!(
            serde_json::to_value(notes).unwrap(),
            serde_json::json!({
                "skipped": ["layout"],
                "outdatedTypst": "0.14.2",
                "readFromSource": "0.13.1"
            })
        );
    }
}
