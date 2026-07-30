# Citations and literature

Citations are a project-index feature with optional metadata lookup. The
BibTeX source remains the authority; external services only supply metadata.

## Implemented surface

- DOI, arXiv ID, URL, and title-based citation lookup.
- Crossref, arXiv, and Semantic Scholar metadata adapters where configured.
- Deduplicated BibTeX insertion keyed by DOI when available.
- Citation-key completion from the project index.
- Undefined citation, duplicate key, and duplicate DOI diagnostics.
- Reference navigation, hover details, find references, and rename support.
- Offline operation for existing local `.bib` files.

## Network and provenance

Lookup requests send the requested identifier or title, not the whole project.
Returned records remain ordinary project source that can be reviewed in the
diff before committing. Provider availability and incomplete metadata are
reported as states rather than silently guessed.

## Engineering anchors

- `src-tauri/src/citation.rs`: DOI, arXiv, and Crossref transport.
- `src-tauri/src/literature.rs`: literature search adapters.
- `src/store/project-index.ts`: bibliography and reference indexing.
- `packages/preflight/src/refs-rules.ts`: reference diagnostics.
- `src/contributions/tabs.tsx`: references rail tab.
