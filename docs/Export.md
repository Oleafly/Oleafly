# Export

Export is engine-aware. The application validates the requested format against
the persisted engine descriptor and writes only to a user-approved destination.

## Output families

- Compiled PDF for all supported document engines.
- Full source archive as a ZIP, excluding application metadata and Git internals.
- Pandoc conversions for Markdown projects, including DOCX, HTML, Markdown, and
  plain text when the descriptor allows them.
- PowerPoint export for Beamer presentations.
- EPUB export for books, reports, and theses where the engine declares it.
- Source and PDF export records retained in project metadata.

## Import and reconstruction

- DOCX import uses Pandoc to create an editable project.
- PDF import performs deterministic local reconstruction into editable LaTeX;
  it reports limits instead of inventing missing text.
- Optional vision assistance can refine an imported project after the user
  connects a provider.

## Integrity and safety

- Export destinations must be absolute, existing, and non-directory paths.
- The Rust sandbox rejects paths outside the approved destination policy.
- Existing artifacts are preserved when a conversion fails.
- The engine descriptor is the source of truth for allowed conversion formats.
- PDF and source downloads use explicit filenames and do not expose credentials.

## Engineering anchors

- `src-tauri/src/project.rs`: PDF, document, and ZIP export commands.
- `src-tauri/src/document_engine.rs`: engine conversion matrix.
- `src-tauri/src/sandbox.rs`: export destination validation.
- `packages/pdf-to-latex/`: deterministic PDF reconstruction.
- `packages/preflight/`: output and accessibility checks before export.
