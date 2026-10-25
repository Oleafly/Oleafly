//! Typst reference rules (`packages/preflight/src/typst-refs-rules.ts`).

use std::collections::HashSet;
use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::messages::message;
use crate::msg;
use crate::refs_rules::{
    bibliography_quality, duplicate_bib_key_findings, duplicate_doi_findings,
    project_label_quality, BibKeyDialect, RefsContext,
};
use crate::text::js_trim;
use crate::types::{Certainty, Finding, Lens, Severity};
use crate::typst::references::{
    typst_at_references, typst_cite_calls, typst_has_bibliography, typst_labels,
    typst_path_references, typst_ref_calls, TypstNameUse, TypstPathKind, TypstPathReference,
};
use crate::typst::scan::{is_external_typst_path, resolve_typst_path, scan_typst, TypstScan};
use crate::typst::TypstSourceFile;

struct ScannedSource {
    path: Option<String>,
    scan: TypstScan,
}

struct BibliographyState {
    declared: bool,
    loaded: bool,
    missing: HashSet<String>,
}

pub fn project_path_exists(files: &[String], from_file: Option<&str>, raw: &str) -> bool {
    if is_external_typst_path(raw) {
        return true;
    }
    let Some(resolved) = resolve_typst_path(from_file, raw) else {
        return false;
    };
    let lower = resolved.to_lowercase();
    files.iter().any(|file| file.to_lowercase() == lower)
}

fn reference_key(path: Option<&str>, reference: &TypstPathReference) -> String {
    format!("{}\0{}", path.unwrap_or(""), reference.from)
}

fn bibliography_state(sources: &[ScannedSource], files: &[String]) -> BibliographyState {
    let declared = sources
        .iter()
        .any(|source| typst_has_bibliography(&source.scan));
    let mut missing = HashSet::new();
    if !files.is_empty() {
        for source in sources {
            for reference in typst_path_references(&source.scan) {
                if reference.kind == TypstPathKind::Bibliography
                    && !project_path_exists(files, source.path.as_deref(), &reference.raw)
                {
                    missing.insert(reference_key(source.path.as_deref(), &reference));
                }
            }
        }
    }
    BibliographyState {
        declared,
        loaded: declared && missing.is_empty(),
        missing,
    }
}

// The .bib files the document loads. Conflict copies, backups and samples
// next to them must not count as repeated keys. Nothing declared keeps every
// file, the same as before a bibliography is added.
fn definitions_in_declared_files(sources: &[ScannedSource], ctx: &RefsContext) -> RefsContext {
    let mut declared: HashSet<String> = HashSet::new();
    for source in sources {
        for reference in typst_path_references(&source.scan) {
            if reference.kind != TypstPathKind::Bibliography {
                continue;
            }
            if let Some(resolved) = resolve_typst_path(source.path.as_deref(), &reference.raw) {
                declared.insert(resolved.to_lowercase());
            }
        }
    }
    let Some(definitions) = ctx
        .bib_key_definitions
        .as_ref()
        .filter(|_| !declared.is_empty())
    else {
        return ctx.clone();
    };
    RefsContext {
        bib_key_definitions: Some(
            definitions
                .iter()
                .filter(|definition| declared.contains(&definition.file.to_lowercase()))
                .cloned()
                .collect(),
        ),
        ..ctx.clone()
    }
}

fn citations_checkable(bibliography: &BibliographyState, bib_keys: &HashSet<String>) -> bool {
    bibliography.loaded && !bib_keys.is_empty()
}

fn with_file(mut finding: Finding, path: Option<&str>) -> Finding {
    if let Some(path) = path.filter(|path| !path.is_empty()) {
        finding.file = Some(path.to_string());
    }
    finding
}

fn resolves_as_label(name: &str, labels: &HashSet<String>) -> bool {
    if labels.contains(name) {
        return true;
    }
    match name.find(':') {
        Some(colon) if colon > 0 => labels.contains(&name[colon + 1..]),
        _ => false,
    }
}

static PACKAGE_IMPORT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r#"#import\s+"@[^"\n]+""#));

fn imports_package(sources: &[ScannedSource]) -> bool {
    sources
        .iter()
        .any(|source| PACKAGE_IMPORT.is_match(source.scan.masked.as_str()))
}

struct ReferenceTally {
    cited: Vec<String>,
    cited_set: HashSet<String>,
    citations: usize,
}

impl ReferenceTally {
    fn cite(&mut self, name: &str) {
        if self.cited_set.insert(name.to_string()) {
            self.cited.push(name.to_string());
        }
    }
}

fn undefined_ref_finding(use_: &TypstNameUse, packages: bool) -> Finding {
    let mut finding = Finding::new(
        "refs-undefined-ref",
        Lens::Refs,
        if packages {
            Severity::Warning
        } else {
            Severity::Error
        },
        msg!("rules.refs-undefined-ref.titleTypst", "label" => &use_.name),
        message(if packages {
            "rules.refs-undefined-ref.detailTypstPackage"
        } else {
            "rules.refs-undefined-ref.detailTypst"
        }),
    )
    .with_range(use_.from, use_.to);
    if packages {
        finding.certainty = Some(Certainty::Advisory);
    }
    finding
}

fn label_reference_findings(
    source: &ScannedSource,
    labels: &HashSet<String>,
    bib_keys: &HashSet<String>,
    bibliography: &BibliographyState,
    tally: &mut ReferenceTally,
    packages: bool,
) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut uses = typst_at_references(&source.scan);
    uses.extend(typst_ref_calls(&source.scan));
    for use_ in uses {
        if resolves_as_label(&use_.name, labels) {
            continue;
        }
        if bib_keys.contains(&use_.name) {
            tally.cite(&use_.name);
            tally.citations += 1;
            continue;
        }
        if !citations_checkable(bibliography, bib_keys) && bibliography.declared {
            continue;
        }
        out.push(undefined_ref_finding(&use_, packages));
    }
    out
}

fn cite_call_findings(
    source: &ScannedSource,
    bib_keys: &HashSet<String>,
    bibliography: &BibliographyState,
    tally: &mut ReferenceTally,
) -> Vec<Finding> {
    let mut out = Vec::new();
    for use_ in typst_cite_calls(&source.scan) {
        tally.citations += 1;
        if bib_keys.contains(&use_.name) {
            tally.cite(&use_.name);
            continue;
        }
        if !citations_checkable(bibliography, bib_keys) {
            continue;
        }
        out.push(
            Finding::new(
                "refs-undefined-cite",
                Lens::Refs,
                Severity::Error,
                msg!("rules.refs-undefined-cite.titleTypst", "key" => &use_.name),
                message("rules.refs-undefined-cite.detailTypst"),
            )
            .with_range(use_.from, use_.to),
        );
    }
    out
}

fn duplicate_label_findings(scan: &TypstScan) -> Vec<Finding> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for label in typst_labels(scan) {
        if seen.insert(label.name.clone()) {
            continue;
        }
        out.push(
            Finding::new(
                "refs-duplicate-label",
                Lens::Refs,
                Severity::Warning,
                msg!("rules.refs-duplicate-label.title", "label" => &label.name),
                message("rules.refs-duplicate-label.detail"),
            )
            .with_range(label.from, label.to),
        );
    }
    out
}

fn asset_findings(
    source: &ScannedSource,
    files: &[String],
    bibliography: &BibliographyState,
) -> Vec<Finding> {
    if files.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for reference in typst_path_references(&source.scan) {
        if reference.kind == TypstPathKind::Bibliography {
            if !bibliography
                .missing
                .contains(&reference_key(source.path.as_deref(), &reference))
            {
                continue;
            }
            out.push(
                Finding::new(
                    "refs-bib-missing",
                    Lens::Refs,
                    Severity::Error,
                    msg!("rules.refs-bib-missing.title", "file" => &reference.raw),
                    message("rules.refs-bib-missing.detailTypst"),
                )
                .with_certainty(Certainty::Verified)
                .with_range(reference.call_from, reference.call_to),
            );
            continue;
        }
        if reference.kind == TypstPathKind::Data
            || project_path_exists(files, source.path.as_deref(), &reference.raw)
        {
            continue;
        }
        let image = reference.kind == TypstPathKind::Image;
        out.push(
            Finding::new(
                "refs-missing-asset",
                Lens::Refs,
                Severity::Error,
                msg!(
                    if image {
                        "rules.refs-missing-asset.titleImage"
                    } else {
                        "rules.refs-missing-asset.titleInclude"
                    },
                    "file" => &reference.raw
                ),
                message(if image {
                    "rules.refs-missing-asset.detailImageTypst"
                } else {
                    "rules.refs-missing-asset.detailIncludeTypst"
                }),
            )
            .with_range(reference.call_from, reference.call_to),
        );
    }
    out
}

pub fn run_typst_refs_rules(sources: &[TypstSourceFile], ctx: &RefsContext) -> Vec<Finding> {
    let scanned: Vec<ScannedSource> = sources
        .iter()
        .map(|source| ScannedSource {
            path: source.path.clone(),
            scan: scan_typst(&source.content),
        })
        .collect();
    let files = &ctx.project_files;
    let bibliography = bibliography_state(&scanned, files);
    let mut labels: HashSet<String> = ctx
        .defined_labels
        .iter()
        .map(|label| js_trim(label).to_string())
        .collect();
    for source in &scanned {
        for label in typst_labels(&source.scan) {
            labels.insert(label.name);
        }
    }
    let bib_keys: HashSet<String> = ctx
        .bib_keys
        .iter()
        .map(|key| js_trim(key).to_string())
        .collect();
    let mut tally = ReferenceTally {
        cited: Vec::new(),
        cited_set: HashSet::new(),
        citations: 0,
    };
    let packages = imports_package(&scanned);

    let mut per_file = Vec::new();
    for source in &scanned {
        let mut findings = label_reference_findings(
            source,
            &labels,
            &bib_keys,
            &bibliography,
            &mut tally,
            packages,
        );
        findings.extend(cite_call_findings(
            source,
            &bib_keys,
            &bibliography,
            &mut tally,
        ));
        findings.extend(duplicate_label_findings(&source.scan));
        findings.extend(asset_findings(source, files, &bibliography));
        findings.sort_by_key(|finding| finding.from.unwrap_or(0));
        per_file.extend(
            findings
                .into_iter()
                .map(|finding| with_file(finding, source.path.as_deref())),
        );
    }

    let mut project = Vec::new();
    if tally.citations > 0 && !bibliography.declared {
        project.push(
            Finding::new(
                "refs-no-bibliography",
                Lens::Refs,
                Severity::Error,
                message("rules.refs-no-bibliography.title"),
                message("rules.refs-no-bibliography.detail"),
            )
            .with_certainty(Certainty::Verified),
        );
    }
    project.extend(duplicate_doi_findings(ctx, BibKeyDialect::Typst));
    project.extend(bibliography_quality(&RefsContext {
        all_cited_keys: Some(tally.cited.clone()),
        ..ctx.clone()
    }));
    project.extend(project_label_quality(ctx));
    project.extend(duplicate_bib_key_findings(
        &definitions_in_declared_files(&scanned, ctx),
        BibKeyDialect::Typst,
    ));
    per_file.extend(project);
    per_file
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(path: &str, content: &str) -> TypstSourceFile {
        TypstSourceFile {
            path: Some(path.to_string()),
            content: content.to_string(),
        }
    }

    #[test]
    fn at_reference_to_a_known_label_resolves() {
        let ctx = RefsContext::default();
        let found = run_typst_refs_rules(
            &[source("main.typ", "See @fig:plot.\n#figure[x] <fig:plot>")],
            &ctx,
        );
        assert!(found.iter().all(|f| f.id != "refs-undefined-ref"));
        let missing = run_typst_refs_rules(&[source("main.typ", "See @nope.")], &ctx);
        assert_eq!(missing[0].id, "refs-undefined-ref");
        assert_eq!(missing[0].file.as_deref(), Some("main.typ"));
    }

    #[test]
    fn citations_without_a_bibliography_are_a_project_error() {
        let ctx = RefsContext::default();
        let found = run_typst_refs_rules(&[source("main.typ", "#cite(<smith>)")], &ctx);
        assert!(found.iter().any(|f| f.id == "refs-no-bibliography"));
    }

    #[test]
    fn a_missing_bibliography_file_is_reported_at_its_call() {
        let ctx = RefsContext {
            project_files: vec!["main.typ".into()],
            ..RefsContext::default()
        };
        let found = run_typst_refs_rules(
            &[source("main.typ", "#bibliography(\"missing.bib\")")],
            &ctx,
        );
        let missing = found.iter().find(|f| f.id == "refs-bib-missing").unwrap();
        assert_eq!((missing.from, missing.to), (Some(1), Some(28)));
    }
}
