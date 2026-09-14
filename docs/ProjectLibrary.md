# Project library

The library is the project lifecycle surface. It stores ordinary project
folders and metadata while providing discovery, templates, previews, and
recent-work navigation.

<div align="center">
  <img src="assets/readme/start-work.png" alt="Oleafly start screen offering a research project, project import, or template" width="100%" />
</div>
<p align="center"><em>Start with the kind of work you actually have: a new project, an existing project, or a template.</em></p>

## Implemented surface

- Project cards with engine, document kind, modification, bookmark, and preview
  state.
- Search over project name, engine, main document, kind, and metadata.
- Field filters such as engine, bookmark, and preview state.
- Create, duplicate, rename, archive, and delete project operations through the
  filesystem sandbox.
- Main-document and engine metadata persisted with each project.
- Compile and export history associated with the project.
- Template gallery integration and optional template-pack downloads.
- PDF and source import entry points.

<div align="center">
  <img src="assets/readme/project-library.png" alt="Oleafly project library with research projects organized as cards" width="100%" />
</div>
<p align="center"><em>Keep manuscripts discoverable without moving the project folders that contain them.</em></p>

The library also keeps import paths close to project creation. Existing
project archives, Word documents, Markdown, HTML, Typst, arXiv sources, and
GitHub repositories can start a new project without changing the original.

<div align="center">
  <img src="assets/readme/import-project.png" alt="Oleafly import project dialog for archives, documents, arXiv sources, and GitHub repositories" width="100%" />
</div>
<p align="center"><em>Bring the work you already have into a new project while leaving the original alone.</em></p>

## Engineering boundaries

- Project source remains a normal directory and can be opened outside Oleafly.
- The library does not use a proprietary document database.
- Metadata is separate from source files and is not required for command-line
  compilation.
- Project IDs and filesystem paths are validated in Rust before mutation.

## Engineering anchors

- `src/components/library/`: library and project creation UI.
- `src/store/library.ts` and `src/store/project.ts`: client state.
- `src-tauri/src/project.rs`: lifecycle, metadata, and import/export commands.
- `src-tauri/src/paths.rs` and `src-tauri/src/sandbox.rs`: path policy.
