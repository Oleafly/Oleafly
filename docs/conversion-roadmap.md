# Conversion roadmap: what is deliberately not built yet

The [conversion matrix](conversion-matrix.md) lists every route Oleafly ships
today. This page is the other half of that contract: the conversions and
tools we have chosen not to build yet, each with the internal gap id it is
tracked under and the reason it waits. A deferred item here is a decision,
not an oversight; when one ships, its row moves to the matrix and the entry
here is deleted.

Gap ids (G-numbers) reference the internal gap register that drives
sequencing. Effort notes are rough: S means days, M means a few weeks, L
means a quarter or more.

## Import depth

- **Local assets beside imported files (M).** Single-file Markdown, HTML,
  and Typst conversion does not copy every sibling image or included file.
  Add those files to the imported project and check their paths. A dependency
  copier needs to limit total size, stay inside the chosen source folder,
  and report missing files before it can run automatically.

- **Local equation and handwriting recognition (G3, M).** Today a vision
  model transcribes one equation at the cursor. A local ONNX recognizer with
  detection for full photos and whiteboards is planned; until then this
  stays a per-equation convenience, not a bulk import.
- **Whiteboard and notes-photo import (G3, M).** Same stage as above; both
  need detection plus batch recognition before the result is worth saving.

## Citation finishing

- **CSL style picker (G4, S–M).** The reference tool renders eight styles
  locally, but a compiled bibliography still takes its style from the document
  source. A picker that writes the chosen style into the document has not been
  implemented.
- **Zotero live sync (G5, M).** The connector stores a key, and RDF exports
  import fine, but nothing calls the Zotero API yet.
- **Word-import citation recovery (G8, M).** Importing a .docx flattens
  citations to plain text. Recovering them means parsing the reference list
  and matching it against Crossref on the way in. This needs confidence checks and a review step before recovered references are added.

## PDF pipeline quality

- **Compile-verify loop (G12, M).** Conversions that produce .tex are not
  automatically compiled and repaired yet. Every component exists locally
  (isolated compile, diagnostics, agent edits); the loop is not closed.
- **Layout-model ingestion (G13, M–L).** The text-layer PDF pipeline is our
  own and handles columns, math, and figures, but a layout-model stage would
  raise the ceiling. Also the reason PDF to Word, HTML, and Markdown are
  deferred: those go through LaTeX today and would inherit the same ceiling.

## Assistant substrate

- **Embedding retrieval (G20, M).** Project retrieval uses lexical search. Semantic retrieval needs an embedding model and an index.
- **Generic web tools for the agent (G21, S).** The assistant reaches
  scholarly APIs and the user's browser, not the open web.
- **Autonomous compile fixing (G22, M).** Diagnostics, one-click
  deterministic fixes, and an ask-the-assistant handoff exist; the
  unattended fix-and-recompile loop does not.
- **Venue-rubric review (G24, M), overlap checking (G25, M), AI-writing
  detector (G26, S).** None started.

## Platform

- **Collaboration and comments (G27, L).** The standing roadmap item;
  checkpoints and Git cover history in the meantime.
- **Typst parity beyond conversions (G28, M).** Typst now converts in and
  out. Source-to-preview navigation and a dedicated preflight profile remain
  on the roadmap.
- **Browser extension (G29, M).** Nothing shipped.
- **Domain packs (G30–G38, S–M each).** Math, engineering, medical, and
  biology tool packs have not been started.
