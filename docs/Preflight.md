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
- **Accessibility:** reading order, selectable text, document metadata, tags,
  alt text, bookmarks where appropriate, and very small text.
- **References and assets:** missing project files, undefined citations and
  cross-references, duplicate labels and DOIs, incomplete bibliography fields,
  and uncited entries when the whole project is available.
- **Privacy and blind review:** credentials, private keys, sensitive files,
  draft markup, internal comments, author fields, acknowledgements, and PDF
  identity metadata.

The reader view shows extracted PDF text one page at a time. Optional accessible
export preparation adds the LaTeX metadata and alt-text placeholders needed for
tagged LuaLaTeX output.

## Publication profiles

The built-in profiles cover requirements that are stable enough to check for a
general publication, arXiv, IEEE, ACM, a journal article, or a thesis. Event and
journal limits still vary by venue. Preflight does not guess at page counts,
margin rules, file-size limits, or naming instructions that are not in the
selected profile; confirm those against the current call for papers or author
guide.

## Reporting model

Each finding has a severity, certainty, stable rule identifier, explanation,
and a source or PDF location where available. The six checks can run on their
own or together. A check never reports success when its required input was not
available. Source-only results are marked partial until a current PDF exists.

## Engineering anchors

- `packages/preflight/src/engine.ts`: orchestration.
- `packages/preflight/src/source-rules.ts`, `compile-rules.ts`,
  `submission-rules.ts`, `refs-rules.ts`, and `pdf-rules.ts`: rules.
- `packages/preflight/src/profiles.ts`: declarative publication profiles.
- `packages/preflight/src/pdf-text.ts` and `structure.ts`: output analysis.
- `packages/preflight/src/accessible-prep.ts`: tagged-export preparation.
- `src/components/preflight/`: product surface.
