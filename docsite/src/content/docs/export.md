---
title: "Export formats"
description: "PDF and full source always; Word, HTML, Markdown, and plain text via on-demand pandoc; PowerPoint for Beamer decks and EPUB for books. Context-aware and one menu away."
---

The **Export** menu (the download icon in the top toolbar) gets your work out of Oleafly in whatever shape the destination demands. It's context-aware: the menu offers what makes sense for the document you're looking at.

## Always available

- **Export source (.zip)**: the complete project source, cleanly archived (no build caches, no `.git`). This is the "send it to a co-author" and "upload to the journal submission system" format.
- **Export as PDF**: the compiled PDF via a native save dialog. It needs a compile first; the menu says so if you haven't. Output is ATS-clean by default: real selectable Unicode text, embedded subset fonts.

## Document formats, via pandoc

- **Export as Word (.docx)**: for the collaborator who insists on tracked changes.
- **Export as HTML (.html)**: a single self-contained file with embedded resources and MathML for equations.
- **Export as Markdown (.md)** and **Export as Plain text (.txt)**.

These run through [pandoc](https://pandoc.org). You don't install it: the first export downloads pandoc automatically into Oleafly's own folder, with progress shown, and reuses it from then on.

## Context-aware formats

The menu reads your document class:

- **Export as PowerPoint (.pptx)**: Beamer presentations only. Each frame becomes a slide.
- **Export as EPUB (.epub)**: books, reports, and theses. Ships with a generated table of contents.
- **Export as PNG (raster image)**: image projects (standalone figures) only, alongside their vector PDF export.

## Save into the project instead

Different from exporting: the [PDF preview's](/Oleafly/pdf-preview/#the-toolbar-left-to-right) **Save PDF to project** writes the compiled PDF into the project tree itself, committed via Git. Use it to snapshot "the version I submitted" next to your source.

## Tagged, accessible PDFs

For a Section 508 / PDF-UA oriented PDF with a real tag structure, use the [Preflight accessible-export flow](/Oleafly/preflight/#accessible-tagged-pdf-export); the result lands in the same build output and downloads like any other PDF.

## Bookkeeping

Each project remembers its recent exports (the last 50) in its own metadata, and every export ends with a toast that has a **View File** shortcut to the result.
