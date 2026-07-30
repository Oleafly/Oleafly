# Document preflight

Preflight is a deterministic readiness layer over source, project structure,
and compiled PDF output. It is guidance and diagnostics, not a formal
accessibility certification.

## Checks

- ATS-oriented extraction for resumes and structured documents.
- PDF reading order, selectable text, metadata, and tag-tree checks.
- Missing assets, undefined references, duplicate labels, and duplicate
  bibliography entries.
- Source layout risks such as columns used for layout, missing alt text, and
  skipped heading levels.
- Contact-information and descriptive-link checks.
- Plain-text extraction preview showing what a parser or screen reader sees.
- Optional preparation of LaTeX metadata and alt-text placeholders for tagged
  LuaLaTeX output.

## Reporting model

Each finding has a severity, stable rule identifier, explanation, and source or
PDF location where available. ATS, accessibility, and reference lenses can be
run independently or together. A check never reports success when its input
could not be inspected.

## Engineering anchors

- `packages/preflight/src/engine.ts`: orchestration.
- `packages/preflight/src/source-rules.ts` and `pdf-rules.ts`: rules.
- `packages/preflight/src/pdf-text.ts` and `structure.ts`: output analysis.
- `packages/preflight/src/accessible-prep.ts`: tagged-export preparation.
- `src/components/preflight/`: product surface.
