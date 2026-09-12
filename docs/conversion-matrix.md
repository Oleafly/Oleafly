# Conversion matrix

Every document conversion Oleafy ships or has deliberately deferred,
generated from `packages/conversion-registry` by `pnpm gen:conversion-matrix`.
Edit the registry, not this file.

Legend: ✅ shipped · 🟡 deferred with a gap id · — not applicable.

| Source ↓ / Target → | PDF | DOCX | HTML | Markdown | LaTeX | Typst | BibTeX | SVG / PNG |
|---|---|---|---|---|---|---|---|---|
| LaTeX project | ✅ [PDF](#latex-to-pdf) | ✅ [Word (.docx)](#latex-to-docx) | ✅ [HTML (MathML)](#latex-to-html) | ✅ [Markdown](#latex-to-markdown) | — | ✅ [Typst](#latex-to-typst) | — | ✅ [Equation SVG / PNG](#latex-to-image) |
| Markdown | ✅ [PDF](#markdown-to-pdf) | ✅ [Word (.docx)](#markdown-to-docx) | ✅ [HTML (MathML)](#markdown-to-html) | — | ✅ [LaTeX](#markdown-to-latex) | ✅ [Typst](#markdown-to-typst) | — | — |
| Typst | ✅ [PDF](#typst-to-pdf) | ✅ [Word (.docx)](#typst-to-docx) | ✅ [HTML (MathML)](#typst-to-html) | ✅ [Markdown](#typst-to-markdown) | ✅ [LaTeX](#typst-to-latex) | — | — | — |
| Word (.docx) | ✅ [PDF](#docx-to-pdf) | — | ✅ [HTML (MathML)](#docx-to-html) | ✅ [Markdown project](#docx-to-markdown) | ✅ [LaTeX project](#docx-to-latex) | ✅ [Typst project](#docx-to-typst) | — | — |
| HTML | ✅ [PDF](#html-to-pdf) | ✅ [Word (.docx)](#html-to-docx) | — | ✅ [Markdown project](#html-to-markdown) | ✅ [LaTeX project](#html-to-latex) | ✅ [Typst project](#html-to-typst) | — | — |
| PDF | — | 🟡 DEFERRED (G13) [Word (.docx)](#pdf-to-docx) | 🟡 DEFERRED (G13) [HTML](#pdf-to-html) | 🟡 DEFERRED (G13) [Markdown](#pdf-to-markdown) | ✅ [LaTeX project](#pdf-to-latex)<br>🟡 DEFERRED (G2) [Scanned PDF to LaTeX](#pdf-scanned-to-latex) | — | — | ✅ [Page PNG](#pdf-to-image) |
| Image (equation or photo) | — | — | — | — | ✅ [LaTeX equation](#image-to-latex) | — | — | — |
| CSV / XLSX | — | — | — | — | ✅ [LaTeX booktabs table](#csv-to-latex) | ✅ [Typst table](#csv-to-typst) | — | — |
| arXiv id | — | — | — | — | ✅ [LaTeX project](#arxiv-to-latex) | — | ✅ [BibTeX](#arxiv-to-bibtex) | — |
| DOI | — | — | — | — | — | — | ✅ [BibTeX](#doi-to-bibtex) | — |
| ISBN | — | — | — | — | — | — | ✅ [BibTeX](#isbn-to-bibtex) | — |
| PMID | — | — | — | — | — | — | ✅ [BibTeX](#pmid-to-bibtex) | — |
| RIS | — | — | — | — | — | — | ✅ [BibTeX](#ris-to-bibtex) | — |
| EndNote XML | — | — | — | — | — | — | ✅ [BibTeX](#endnote-to-bibtex) | — |
| Zotero RDF | — | — | — | — | — | — | ✅ [BibTeX](#zotero-to-bibtex) | — |
| BibTeX library | — | — | — | — | — | — | ✅ [Cleaned library](#bibtex-clean) | — |

## Routes

## LaTeX project

### latex-to-pdf

Compile with the bundled Tectonic engine (or latexmk on a system TeX).

- **Direction:** export
- **Engine:** tectonic
- **Status:** existing
- **Surface:** Export menu

### latex-to-docx

Pandoc writer with native OMML equations.

- **Direction:** export
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Export menu
- **Pandoc route:** `--from=latex --to=docx`

### latex-to-html

Standalone self-contained HTML with MathML equations for accessibility.

- **Direction:** export
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Export menu
- **Gap:** G11
- **Pandoc route:** `--from=latex --to=html5 --standalone --embed-resources --mathml`

### latex-to-markdown

Pandoc writer; math lands in dollar delimiters.

- **Direction:** export
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Export menu
- **Pandoc route:** `--from=latex --to=markdown`

### latex-to-typst

Pandoc's typst writer with a fixup for its empty font declaration.

- **Direction:** export
- **Engine:** pandoc
- **Status:** available
- **Surface:** Export menu
- **Gap:** G10
- **Pandoc route:** `--from=latex --to=typst --standalone`

### latex-to-image

Render a selected equation with MathJax and save it as SVG or PNG.

- **Direction:** tool
- **Engine:** internal
- **Status:** available
- **Surface:** Editor context menu, Equation tool
- **Gap:** G16

## Markdown

### markdown-to-pdf

Pandoc compiles through the bundled Tectonic engine with citeproc.

- **Direction:** export
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Export menu

### markdown-to-docx

Pandoc writer.

- **Direction:** export
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Export menu
- **Pandoc route:** `--from=markdown --to=docx`

### markdown-to-html

Standalone self-contained HTML with MathML equations.

- **Direction:** export
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Export menu
- **Pandoc route:** `--from=markdown --to=html5 --standalone --embed-resources --mathml`

### markdown-to-latex

Import as a LaTeX project, or export .tex from a Markdown project.

- **Direction:** import
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Import dialog, Export menu
- **Pandoc route:** `--from=markdown --to=latex --standalone`

### markdown-to-typst

Import as a Typst project, or export .typ from a Markdown project.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog, Export menu
- **Gap:** G10
- **Pandoc route:** `--from=markdown --to=typst --standalone`

## Typst

### typst-to-pdf

Compile with the bundled Typst engine.

- **Direction:** export
- **Engine:** typst
- **Status:** existing
- **Surface:** Export menu

### typst-to-latex

Import a Typst file as a LaTeX project, or export .tex from a Typst project.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog, Export menu
- **Gap:** G10
- **Pandoc route:** `--from=typst --to=latex --standalone`

### typst-to-markdown

Pandoc's markdown writer; import as a Markdown project or export .md.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog, Export menu
- **Gap:** G28
- **Pandoc route:** `--from=typst --to=markdown --standalone`

### typst-to-html

Standalone HTML export from a Typst project.

- **Direction:** export
- **Engine:** pandoc
- **Status:** available
- **Surface:** Export menu
- **Gap:** G28
- **Pandoc route:** `--from=typst --to=html5 --standalone --embed-resources --mathml`

### typst-to-docx

Pandoc reads Typst directly and writes a .docx with OMML equations.

- **Direction:** export
- **Engine:** pandoc
- **Status:** available
- **Surface:** Export menu
- **Gap:** G28
- **Pandoc route:** `--from=typst --to=docx`

## Word (.docx)

### docx-to-latex

Pandoc turns the document into a project, with OMML equations and media extracted to assets/.

- **Direction:** import
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Import dialog
- **Pandoc route:** `--from=docx --to=latex --standalone --extract-media=assets`

### docx-to-markdown

Import as a Markdown project; export other formats from there.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G10
- **Pandoc route:** `--from=docx --to=markdown --standalone --extract-media=assets`

### docx-to-typst

Import as a Typst project.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G10
- **Pandoc route:** `--from=docx --to=typst --standalone --extract-media=assets`

### docx-to-pdf

Import as a LaTeX project, then compile.

- **Direction:** import
- **Engine:** pandoc
- **Status:** existing
- **Surface:** Import dialog

### docx-to-html

Import as a Markdown project, then export self-contained HTML with MathML.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog, then Export menu
- **Gap:** G10

## HTML

### html-to-latex

Pandoc's html reader; embedded images are extracted to assets/.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G10
- **Pandoc route:** `--from=html --to=latex --standalone --extract-media=assets`

### html-to-markdown

Import as a Markdown project.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G10
- **Pandoc route:** `--from=html --to=markdown --standalone --extract-media=assets`

### html-to-typst

Import as a Typst project.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G10
- **Pandoc route:** `--from=html --to=typst --standalone --extract-media=assets`

### html-to-pdf

Import as a LaTeX project, then compile.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G10

### html-to-docx

Import as a LaTeX or Markdown project, then export Word.

- **Direction:** import
- **Engine:** pandoc
- **Status:** available
- **Surface:** Import dialog, then Export menu
- **Gap:** G10

## PDF

### pdf-to-latex

The built-in text-layer pipeline: columns, headings, math detection, and figure extraction.

- **Direction:** import
- **Engine:** pdf-pipeline
- **Status:** existing
- **Surface:** Import dialog

### pdf-to-image

Render any page of the compiled PDF to a PNG at 3x.

- **Direction:** export
- **Engine:** pdf-pipeline
- **Status:** available
- **Surface:** Export menu

### pdf-to-docx

Not built yet.

- **Direction:** import
- **Engine:** pdf-pipeline
- **Status:** deferred
- **Surface:** Import dialog
- **Gap:** G13
- **Deferred because:** PDF ingestion quality (G13) needs the layout-model stage before Word output is worth shipping; today it goes PDF to LaTeX to .docx.

### pdf-to-html

Not built yet.

- **Direction:** import
- **Engine:** pdf-pipeline
- **Status:** deferred
- **Surface:** Import dialog
- **Gap:** G13
- **Deferred because:** Same quality gate as PDF to Word; the LaTeX path exists today.

### pdf-to-markdown

Not built yet.

- **Direction:** import
- **Engine:** pdf-pipeline
- **Status:** deferred
- **Surface:** Import dialog
- **Gap:** G13
- **Deferred because:** Same quality gate as PDF to Word; the LaTeX path exists today.

### pdf-scanned-to-latex

Scanned pages stop at a clear no-text-layer message.

- **Direction:** import
- **Engine:** pdf-pipeline
- **Status:** deferred
- **Surface:** Import dialog
- **Gap:** G2
- **Deferred because:** OCR for scanned PDFs is not in yet; the importer reports which pages have no text layer.

## Image (equation or photo)

### image-to-latex

A vision model transcribes an equation or table photo to LaTeX at the cursor.

- **Direction:** tool
- **Engine:** internal
- **Status:** existing
- **Surface:** Editor toolbar

## CSV / XLSX

### csv-to-latex

Parse CSV (or XLSX via SheetJS) and emit a booktabs table with full escaping, insertable at the cursor.

- **Direction:** tool
- **Engine:** internal
- **Status:** available
- **Surface:** Editor context menu, Table tool
- **Gap:** G17

### csv-to-typst

Same parser, Typst table emitter.

- **Direction:** tool
- **Engine:** internal
- **Status:** available
- **Surface:** Editor context menu, Table tool
- **Gap:** G17

## arXiv id

### arxiv-to-latex

Download the e-print tarball, unpack it, and infer the main document.

- **Direction:** import
- **Engine:** api-lookup
- **Status:** available
- **Surface:** Import dialog
- **Gap:** G7

### arxiv-to-bibtex

The arXiv Atom entry becomes a citation.

- **Direction:** tool
- **Engine:** api-lookup
- **Status:** existing
- **Surface:** Add citation dialog

## DOI

### doi-to-bibtex

doi.org content negotiation.

- **Direction:** tool
- **Engine:** api-lookup
- **Status:** existing
- **Surface:** Add citation dialog

## ISBN

### isbn-to-bibtex

OpenLibrary lookup for books.

- **Direction:** tool
- **Engine:** api-lookup
- **Status:** available
- **Surface:** Add citation dialog
- **Gap:** G7

## PMID

### pmid-to-bibtex

NCBI E-utilities lookup for PubMed articles.

- **Direction:** tool
- **Engine:** api-lookup
- **Status:** available
- **Surface:** Add citation dialog
- **Gap:** G7

## RIS

### ris-to-bibtex

RIS export files import into the reference library.

- **Direction:** import
- **Engine:** internal
- **Status:** existing
- **Surface:** References panel

## EndNote XML

### endnote-to-bibtex

EndNote XML export files import into the reference library.

- **Direction:** import
- **Engine:** internal
- **Status:** existing
- **Surface:** References panel

## Zotero RDF

### zotero-to-bibtex

Zotero RDF export files import into the reference library.

- **Direction:** import
- **Engine:** internal
- **Status:** existing
- **Surface:** References panel

## BibTeX library

### bibtex-clean

Normalize keys, drop DOI and fuzzy-title duplicates, and report missing fields with a dry-run diff.

- **Direction:** tool
- **Engine:** internal
- **Status:** available
- **Surface:** References panel, BibTeX tool
- **Gap:** G6

## Deferred

- **pdf-to-docx** (G13): PDF ingestion quality (G13) needs the layout-model stage before Word output is worth shipping; today it goes PDF to LaTeX to .docx.
- **pdf-to-html** (G13): Same quality gate as PDF to Word; the LaTeX path exists today.
- **pdf-to-markdown** (G13): Same quality gate as PDF to Word; the LaTeX path exists today.
- **pdf-scanned-to-latex** (G2): OCR for scanned PDFs is not in yet; the importer reports which pages have no text layer.
