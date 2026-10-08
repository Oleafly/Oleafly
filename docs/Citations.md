# Citations and literature

Citations are a project-index feature with optional metadata lookup. The
BibTeX source remains the authority; external services only supply metadata.

## Implemented surface

- DOI, arXiv ID, URL, and title-based citation lookup.
- Crossref, arXiv, and Semantic Scholar metadata adapters where configured.
- Multi-source Citation Search (manual query across arXiv, Semantic Scholar,
  Crossref, PubMed, OpenAlex; optional Google Scholar via Serper).
- Deduplicated BibTeX insertion keyed by DOI when available.
- Citation-key completion from the project index and the Zotero library.
- Undefined citation and duplicate key diagnostics. Preflight and the BibTeX
  Validator also report duplicate DOIs.
- Reference navigation, hover details, find references, and rename support.
- Offline operation for existing local `.bib` files.
- Import a whole Zotero library from a project's References panel with
  **Import Zotero library**. Connect Zotero first in Settings > Integrations
  with your user ID and an API key, which Oleafly checks before saving. Up to
  5,000 items come in as BibTeX, and references already in the bibliography
  are skipped.
- Hayagriva `.yml` bibliographies in Typst projects: keys complete and resolve,
  and a new citation goes into the bibliography the document declares. The
  References panel has a **Citation style** picker for Typst.

## Citing from your Zotero library

Oleafly reads your Zotero library and never changes it.

- **Connecting.** With Zotero 7 or newer open on the same computer, turn on
  "Allow other applications on this computer to communicate with Zotero" once,
  in Zotero's Settings > Advanced. Oleafly finds Zotero by itself. When Zotero
  isn't running, a zotero.org account with an API key works instead. If Zotero
  on this computer syncs with a different account, or doesn't sync at all, `@`
  search keeps using the copy Oleafly last read from Zotero, and the list says
  Zotero is closed. Group libraries come along, and each library can be turned
  off in Settings > Integrations > Zotero. **Test connection** there reports
  the Zotero and Better BibTeX versions and how many items each library has.
- **Citing.** Type `@` and part of an author, a title word, a year or a key.
  The list ranks the project's `.bib` entries and the whole Zotero library
  together. Picking a Zotero item inserts the citation and appends only that
  entry to the project's bibliography. LaTeX gets the cite command the
  document already uses most (`\citep`, `\parencite` and so on), Typst gets
  `@key` and Markdown gets `[@key]`. Typing `@` inside existing `\cite{...}`
  braces adds another key. **Add citation** (Cmd+K) and the toolbar citation
  button list Zotero matches too.
- **Keys.** A key comes from Better BibTeX when it is running, then from
  Zotero's citation key field, then from a `Citation Key:` line in Extra. Only
  an item with none of these gets a key made by Oleafly, and that key never
  matches one already in the `.bib`. A paper that is in the `.bib` under its
  key or its DOI is never added twice, and when Better BibTeX renames an item,
  the key the document already cites keeps working.
- **Writing the `.bib`.** New entries go at the end and the rest of the file
  is left as it was. Entries come from Better BibTeX's own export when it is
  available, otherwise from Zotero's BibLaTeX or BibTeX export, picked by
  whether the project loads biblatex. A project with no bibliography line gets
  one: `\bibliography` or `\addbibresource` in LaTeX, `#bibliography` in Typst,
  `bibliography:` in Markdown front matter. With several declared files,
  Oleafly asks once which one receives new entries.
- **Keeping the `.bib` in step.** A cited key that is missing from the `.bib`
  but is in Zotero offers **Add from Zotero**. **Add missing citations from
  Zotero** in the command palette adds all of them in one step and lists the
  keys Zotero doesn't have. When an item changes in Zotero, its `.bib` entry
  offers **Update from Zotero**, and an entry you edited by hand is only
  replaced after you confirm. **Update .bib entries from Zotero** reviews every
  changed entry. Nothing is ever removed from the `.bib` automatically.
- **Offline.** The library index lives in Oleafly's data folder, not in the
  project, so `@` search keeps working from the last sync while Zotero is
  closed and says so. It refreshes when the window gets focus again, never on
  a timer.

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
- Successful scans are **cached locally** (same source text, bibliography
  snapshot, and scan settings) for about a day; Clear discards the cache.

## Paper review

Citation Search **Review** mode streams Friendly (constructive mentor) or Fire
(Reviewer #2) feedback for the active document or captured selection, using the
configured AI provider.

## BibTeX editing

A `.bib` file has its own completion and its own checks. Neither waits for the
project index.

- Typing `@` at the start of a line offers the entry types, standard BibTeX
  and the common biblatex ones. Accepting one writes the entry out: braces, a
  placeholder key, and a line for every required field. Tab steps through the
  placeholders. `@string`, `@preamble` and `@comment` are in the same list.
- Inside an entry, a field name completes from the fields that entry type
  takes, with the required ones first.
- In a LaTeX file, `\bibliographystyle{` offers the classic BibTeX styles,
  the natbib variants, the common journal styles and the REVTeX families.
- Entries are checked while you type. A missing required field is marked on
  the key, an unknown entry type on the type, a repeated field on the repeat,
  and a year that is not four digits on the value. Where BibTeX and biblatex
  disagree on a name, either spelling counts, so `journaltitle` satisfies
  `journal` and `date` satisfies `year`.
- `%%novalidate` on a line of its own turns the checks off for the file, and
  `%%begin novalidate` with `%%end novalidate` turns them off for a region.

## OpenAlex contact email and Serper

Optional OpenAlex polite-pool contact email is stored under Integrations as
connector value `openalex-email`. When set, OpenAlex requests send a
`mailto:` suffix in the User-Agent so rate limits improve. The email stays on
the machine; it is not written into project files.

Optional Serper API key (`serper`) enables the Google Scholar source. Without
it, Citation Search leaves Google Scholar out of the search instead of listing
it as a failed source.

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
- `src/components/tools/PaperReviewPanel.tsx`: Friendly/Fire review UI.
- `src/store/project-index.ts`: bibliography and reference indexing.
- `packages/preflight/src/refs-rules.ts`: reference diagnostics.
- `packages/latex/src/bibtex-entry-types.ts`: the one table of entry types
  and required fields shared by completion, the inline linter and preflight.
- `packages/editor/src/bibtex-completions.ts` and `bibtex-linter.ts`: the
  `.bib` completion source and the always-on entry checks.
- `src/contributions/tabs.tsx`: references rail tab.
- `src-tauri/src/zotero/`: Zotero sync (local API and Web API), the library
  index and search, key resolution, entry export and the per-project links
  that remember which `.bib` entry came from which item.
- `src/features/zotero-cite.ts`, `src/features/zotero-actions.ts` and
  `src/components/editor/cm/zotero-completion.ts`: `.bib` writes, missing-key
  and update flows, and the `@` completion source.
- `e2e/mock-zotero-server.ts`: a local mock of Zotero, Better BibTeX and
  zotero.org for development. Debug builds read
  `OLEAFLY_ZOTERO_LOCAL_BASE_URL` and `OLEAFLY_ZOTERO_BASE_URL` to point at it.
