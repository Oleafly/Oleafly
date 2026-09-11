# Document preflight

Preflight checks source files, project structure, the compiler log, and the
current PDF before a document leaves the app. It separates facts Oleafly can
verify from advisory checks that still need an author's judgment. It is not a
guarantee of acceptance or a formal accessibility certificate.

## Checks

- **Compile and layout:** failed builds, unresolved citations and references,
  rerun warnings, missing glyphs, overfull boxes, clipped text, duplicate PDF
  destinations, and mixed page sizes.
- **Submission readiness:** a selected publication profile checks document
  class, abstract and keywords, figure formats, embedded fonts, PDF version and
  restrictions, portable filenames, captions, and clean source packaging.
- **ATS readiness:** resume-parser extraction, contact fields, expected
  sections, and layouts that commonly scramble applicant tracking systems.
- **Accessibility:** tagging, alt text, document language and title, viewer
  settings, heading and table structure, link descriptions, reading order,
  selectable text, bookmarks where appropriate, and very small text.
- **References and assets:** missing project files, undefined citations and
  cross-references, duplicate labels and DOIs, incomplete bibliography fields,
  and uncited entries when the whole project is available.
- **Privacy and blind review:** credentials, private keys, sensitive files,
  draft markup, internal comments, author fields, acknowledgements, and PDF
  identity metadata.

The reader view shows extracted PDF text one page at a time. Optional accessible
export preparation adds the LaTeX metadata, table header declaration, and
alt-text placeholders that tagged output needs.

## Accessibility standards

Accessibility findings cite the clause they are measured against: PDF/UA-1
(ISO 14289-1), PDF/UA-2 where it differs, the Matterhorn Protocol 1.1
checkpoint, and the WCAG 2.2 success criterion with its PDF technique. Every
citation links to the published rule.

The check covers the part of PDF/UA-1 that pdf.js can answer from the file:
whether the PDF is tagged, whether real content sits inside the tag tree,
whether the structure tree carries alt text on figures and formulas and header
cells on tables, whether headings step one level at a time, the catalog
language, the XMP document title and the DisplayDocTitle viewer preference,
the MarkInfo Suspects flag, link annotation descriptions, and whether a
declared PDF/UA claim is backed by the file. pdf.js hands back one structure
tree per page, so an element that runs past a page break arrives twice.
Preflight joins the two copies only when they share content, sit at the same
position inside a container that pdf.js repeats verbatim, or meet exactly at
the page seam with matching shape. Anything less stays separate, so a long
table is scored once while two different tables never hide each other. The
panel reports how many of the
106 machine-checkable PDF/UA-1 rules it verified, and, when some of them could
not be read out of this particular file, how many were left unchecked. A rule
counts as verified only when Preflight read the evidence and the evidence was
clean. A value Preflight could not read stays unchecked, and so does a rule that does
not apply to an untagged file. A rule whose evidence lives in a structure tree that
failed to load is unchecked too. None of those count as a pass. That is a subset
check, not a conformance statement.

When the build log carries the report that `\DocumentMetadata{check-tagging-status}`
writes, Preflight reads it and repeats what LaTeX said about the class and the
loaded packages.

Preflight cannot judge whether alt text is meaningful, whether a reading order
makes sense, or whether color contrast is high enough. Findings that need that
judgment are marked as such. For a formal conformance statement, validate the
PDF with veraPDF or PAC 2024.

## Tagged export compatibility

LaTeX tagging only works when the document class and the loaded packages
support it. Preflight reads the LaTeX Project's own tagging-status data,
vendored as `packages/preflight/src/tagging-status.json`, and refuses to offer
accessible-export preparation for a class the project lists as incompatible or
unsupported. A partly compatible class is offered with a warning, and packages
that cannot tag are listed by name. The gate reads the effective main document,
the same one the compile path uses, so a `% !TEX root` comment redirects it. It
reads the preamble files that document inputs as well, not whichever included
file happens to be open, and it ignores anything that is commented out. When no
main document is loaded, the gate falls back to the open file and says so.

A package the upstream data does not record is reported as unknown and shown as
a caution, never as compatible. Oleafly adds one restriction of its own:
`enumitem` is blocked, because a tagged build cannot load it right now.

Refresh the vendored data with `node scripts/update-tagging-status.mjs`. It
fetches `tagging-status.yml` from `latex3/tagging-project`, keeps every document
class and every package verdict including the compatible ones, validates the
names, types, statuses, uniqueness, and per-category counts before writing, and
records the source URL and the retrieval date in the file.

## Publication profiles

The built-in profiles cover requirements that are stable enough to check for a
general publication, arXiv, IEEE, ACM, a journal article, or a thesis. Event and
journal limits still vary by venue. Preflight does not guess at page counts,
margin rules, file-size limits, or naming instructions that are not in the
selected profile; confirm those against the current call for papers or author
guide.

## Reporting model

Each finding has a severity, certainty, stable rule identifier, explanation,
and a source or PDF location where available. Accessibility findings also
carry the standards they cite, how the result was established (the PDF object
model, the compiler log, a source heuristic, or page geometry), and whether a
machine can decide the requirement at all. The six checks can run on their
own or together. A check never reports success when its required input was not
available. Source-only results are marked partial until a current PDF exists.

## Engineering anchors

- `packages/preflight/src/engine.ts`: orchestration.
- `packages/preflight/src/source-rules.ts`, `compile-rules.ts`,
  `submission-rules.ts`, `refs-rules.ts`, and `pdf-rules.ts`: rules.
- `packages/preflight/src/profiles.ts`: declarative publication profiles.
- `packages/preflight/src/pdf-text.ts` and `structure.ts`: output analysis.
- `packages/preflight/src/standards.ts`: the PDF/UA, Matterhorn, and WCAG table.
- `packages/preflight/src/tagging-status.ts`: the vendored compatibility data.
- `packages/preflight/src/accessible-prep.ts`: tagged-export preparation.
- `src/components/preflight/`: product surface.
