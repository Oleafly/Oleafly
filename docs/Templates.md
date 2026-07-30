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
  projects when a provider is configured.

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
