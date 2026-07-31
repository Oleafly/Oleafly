# Citations and literature

Citations are a project-index feature with optional metadata lookup. The
BibTeX source remains the authority; external services only supply metadata.

## Implemented surface

- DOI, arXiv ID, URL, and title-based citation lookup.
- Crossref, arXiv, and Semantic Scholar metadata adapters where configured.
- Multi-source Citation Search (manual query across scholarly indexes).
- Deduplicated BibTeX insertion keyed by DOI when available.
- Citation-key completion from the project index.
- Undefined citation, duplicate key, and duplicate DOI diagnostics.
- Reference navigation, hover details, find references, and rename support.
- Offline operation for existing local `.bib` files.

## Document citation scan

Citation Search includes a **From document** mode that splits the active
document (or editor selection) into prose paragraphs, searches configured
literature sources for each paragraph, filters results against the project
bibliography, and ranks candidates with a score badge.

- Entry points: mode toggle on Citation Search, command palette **Find
  citations in document**, and optional selection override.
- **Score badges** show a 0–100 relevance score. With a configured AI
  provider, ranking can include short FOR/AGAINST reasoning; without AI, the
  scan falls back to heuristic ranking (citation counts and search order) and
  reasoning is omitted.
- Scan settings (score threshold, max results per paragraph, max paragraphs)
  persist locally. Already-cited records are filtered out when bibliography
  identities are available.

## OpenAlex contact email

Optional OpenAlex polite-pool contact email is stored under Integrations as
connector value `openalex-email`. When set, OpenAlex requests send a
`mailto:` suffix in the User-Agent so rate limits improve. The email stays on
the machine; it is not written into project files.

## Network and provenance

Lookup requests send the requested identifier, title, or short paragraph-derived
query, not the whole project as a bulk upload. Returned records remain ordinary
project source that can be reviewed before committing. Provider availability
and incomplete metadata are reported as states rather than silently guessed.

## Engineering anchors

- `src-tauri/src/citation.rs`: DOI, arXiv, and Crossref transport.
- `src-tauri/src/literature.rs`: literature search adapters (including OpenAlex
  User-Agent polite pool).
- `src/lib/document-citation/`: paragraph split, bibliography filter, ranking,
  document scan orchestration, and paper-review helpers.
- `src/components/tools/DocumentCitationScanPanel.tsx`: From document UI.
- `src/store/project-index.ts`: bibliography and reference indexing.
- `packages/preflight/src/refs-rules.ts`: reference diagnostics.
- `src/contributions/tabs.tsx`: references rail tab.
