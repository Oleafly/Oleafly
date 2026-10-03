# Templates and project starters

Templates are editable source projects, not opaque document snapshots. A
template declares its engine, document kind, main file, preview metadata, and
optional assets so the library can filter and validate it.

## Catalog surface

- Papers, journals, theses, reports, books, Beamer presentations, posters,
  assignments, letters, bibliographies, resumes, and diagrams.
- Filters for engine, category, offline readiness, and ATS suitability.
- Page-one previews and metadata-driven library search.
- Optional template packs and fonts downloaded only after user selection.
- AI-generated starters can be compiled and saved as ordinary editable
  projects when a provider is configured. LaTeX and Typst starters show a
  page-one preview before you save them.
- Bundled Typst starters cover a blank document, a short report, a technical
  report, a two-column conference-style paper, a thesis, a formal letter, a
  resume, and a standalone figure. Each one compiles with Typst 0.13 through
  0.15 without packages.

<div align="center">
  <img src="assets/readme/template-downloads.png" alt="Oleafly Downloads settings showing editable academic, presentation, business, and research templates" width="100%" />
</div>
<p align="center"><em>Choose a starting layout, then edit the files as ordinary project source.</em></p>

## Packaging contract

- Bundled starters live under `src-tauri/resources/templates/`.
- Each template includes a `template.json` manifest and source files.
- Fonts and external assets are kept separate from the core application bundle
  and copied into a project only when requested.
- A template must compile through the engine it declares or report a truthful
  prerequisite state.

## Engineering anchors

- `packages/templates/`: gallery types, host interface, and modal behavior.
- `src/components/library/`: catalog and generation surfaces.
- `src-tauri/resources/templates/`: shipped starter sources.
- `src-tauri/src/project.rs`: project creation and metadata persistence.
