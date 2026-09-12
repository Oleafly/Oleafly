# Conversion roadmap: what is deliberately not built yet

The [conversion matrix](conversion-matrix.md) lists every route Oleafy ships
today. This page is the other half of that contract: the conversions and
tools we have chosen not to build yet, each with the internal gap id it is
tracked under and the reason it waits. A deferred item here is a decision,
not an oversight; when one ships, its row moves to the matrix and the entry
here is deleted.

Gap ids (G-numbers) reference the internal gap register that drives
sequencing. Effort notes are rough: S means days, M means a few weeks, L
means a quarter or more.

## Import depth

- **Scanned-PDF OCR (G2, M).** The PDF importer reports which pages have no
  text layer and stops. Converting scans needs an OCR stage; tesseract.js as
  the always-present fallback with an optional quality model is the planned
  shape.
- **Local equation and handwriting recognition (G3, M).** Today a vision
  model transcribes one equation at the cursor. A local ONNX recognizer with
  detection for full photos and whiteboards is planned; until then this
  stays a per-equation convenience, not a bulk import.
- **Whiteboard and notes-photo import (G3, M).** Same stage as above; both
  need detection plus batch recognition before the result is worth saving.

## Citation finishing

- **CSL style picker (G4, S–M).** Bibliography styling comes from the LaTeX
  class in use. Rendering the ten thousand CSL styles locally is solvable
  in-core; not started.
- **Zotero live sync (G5, M).** The connector stores a key, and RDF exports
  import fine, but nothing calls the Zotero API yet.
- **Word-import citation recovery (G8, M).** Importing a .docx flattens
  citations to plain text. Recovering them means parsing the reference list
  and matching it against Crossref on the way in. Nobody ships this today;
  it is a differentiator when built.

## PDF pipeline quality

- **Compile-verify loop (G12, M).** Conversions that produce .tex are not
  automatically compiled and repaired yet. Every component exists locally
  (isolated compile, diagnostics, agent edits); the loop is not closed.
- **Layout-model ingestion (G13, M–L).** The text-layer PDF pipeline is our
  own and handles columns, math, and figures, but a layout-model stage would
  raise the ceiling. Also the reason PDF to Word, HTML, and Markdown are
  deferred: those go through LaTeX today and would inherit the same ceiling.

## Assistant substrate

- **Embedding retrieval (G20, M).** Project retrieval is lexical; no vector
  index anywhere yet.
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
  out, but has no SyncTeX equivalent, no isolated compile, and no preflight
  profile.
- **Browser extension (G29, M).** Nothing shipped.
- **Domain packs (G30–G38, S–M each).** Math, engineering, medical, and
  biology tool packs; whitespace today.

## Editor niceties

- **Mermaid to TikZ (G19, M).** Mermaid renders in chat; converting a
  diagram to TikZ deterministically is not built.
