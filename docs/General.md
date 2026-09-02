# General application surface

General features are the application shell around the editor and document
engines. They provide project lifecycle, navigation, preferences, and local
state without changing the source format.

## Implemented areas

- Project library with engine, document kind, modification, bookmark, and
  preview metadata.
- Create LaTeX, Typst, and Markdown projects from editable templates.
- Nested source tree with create, rename, duplicate, delete, and main-document
  selection operations.
- Autosave with dirty-state and compile-result freshness tracking.
- Command palette and omnibar for project and document actions.
- Light and dark themes using shared design tokens.
- Settings for engines, language servers, AI providers, MCP, shortcuts, and
  downloads.
- Local word count, project search, logs, and diagnostic surfaces.
- Update checks through the signed application updater.

## Local-first policy

Project files, optional Git history, compiled artifacts, indexing, preview
rendering, spellchecking, and preflight remain local unless the user selects a
network operation. The app has no mandatory account or telemetry requirement.

## Engineering anchors

- `src/store/`: application state domains.
- `src/components/library/`: project library and template selection.
- `src/components/settings/`: settings surfaces.
- `src/contributions/`: palette, rail, and command registration.
- `src-tauri/src/paths.rs` and `src-tauri/src/sandbox.rs`: path policy.
