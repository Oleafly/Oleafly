# Tools gallery

Oleafly's Tools gallery collects focused jobs that do not always need a full
project. Open it from the omnibar, the command palette, or a slash command.
Search matches the tool name, description, and slash aliases. A tool that
needs a network connection or an AI provider says so in its own panel.

<div align="center">
  <img src="assets/readme/tools-gallery.png" alt="Oleafly Tools gallery showing converters, research tools, citation tools, and writing tools" width="100%" />
</div>
<p align="center"><em>Open a focused tool, do the small job, and keep the result when it belongs in your project.</em></p>

The catalog below follows the built-in tool registry. Each ID is the tool's
stable name; the aliases in the last column are accepted by the command
palette and slash-command menu.

## Converters

| ID | Tool | What it does | Slash aliases |
| --- | --- | --- | --- |
| `image-to-latex` | Image to LaTeX | Turn notes, equations, or a table in an image into editable LaTeX. | `/image-to-latex` |
| `pdf-to-latex` | PDF to LaTeX | Reconstruct editable LaTeX from a PDF, including math, figures, and structure where the source allows it. | `/pdf-to-latex`, `/pdf-import` |
| `visual-typst-editor` | Visual Typst Editor | Start a Typst document in the project editor with live preview. | `/visual-typst-editor`, `/typst-visual` |
| `arxiv-to-latex` | arXiv to LaTeX | Download an arXiv source bundle or open a saved archive from disk. | `/arxiv-to-latex`, `/arxiv-source` |
| `equation-to-latex` | Equation to LaTeX | Convert typed math or an equation image into LaTeX. | `/equation-to-latex`, `/math-to-latex` |
| `excel-to-latex` | Excel to LaTeX | Convert Excel, CSV, or TSV data into an escaped LaTeX table. | `/excel-to-latex`, `/spreadsheet-to-latex` |
| `html-to-latex` | HTML to LaTeX | Convert pasted HTML into a standalone LaTeX document. | `/html-to-latex` |
| `image-to-typst` | Image to Typst | Turn notes, equations, or a table in an image into editable Typst. | `/image-to-typst` |
| `latex-to-html` | LaTeX to HTML | Convert LaTeX into standalone HTML with MathML equations. | `/latex-to-html` |
| `latex-to-image` | LaTeX to Image | Render a LaTeX equation and export PNG or SVG. | `/latex-to-image`, `/latex-preview` |
| `latex-to-markdown` | LaTeX to Markdown | Convert a LaTeX document into portable Markdown. | `/latex-to-markdown` |
| `latex-to-typst` | LaTeX to Typst | Convert LaTeX into Typst source that you can copy, save, or open as a project. | `/latex-to-typst` |
| `latex-to-word` | LaTeX to Word | Create a DOCX with equations stored as native Word math. | `/latex-to-word`, `/latex-to-docx` |
| `markdown-to-latex` | Markdown to LaTeX | Convert Markdown notes into a standalone LaTeX document. | `/markdown-to-latex` |
| `markdown-to-typst` | Markdown to Typst | Convert Markdown notes into Typst source. | `/markdown-to-typst` |
| `mermaid-to-latex` | Mermaid to LaTeX | Convert a Mermaid flowchart into editable TikZ code. | `/mermaid-to-latex`, `/mermaid-to-tikz` |
| `pdf-to-markdown` | PDF to Markdown | Extract a PDF text layer, equations, and figures into Markdown. | `/pdf-to-markdown` |
| `pdf-to-typst` | PDF to Typst | Extract a PDF text layer, equations, and figures into Typst. | `/pdf-to-typst` |
| `table-to-latex` | Table to LaTeX | Build a LaTeX table in a visual row-and-column editor. | `/table-to-latex`, `/latex-table`, `/table-generator` |
| `typst-editor` | Typst Editor | Start a Typst project with source editing, live preview, and PDF export. | `/typst-editor`, `/new-typst` |
| `typst-to-latex` | Typst to LaTeX | Convert Typst markup into LaTeX for journals and submissions. | `/typst-to-latex` |
| `word-to-latex` | Word to LaTeX | Convert a Word document into LaTeX while keeping extracted media together. | `/word-to-latex`, `/docx-to-latex` |

Most conversions use local files and the installed or bundled toolchain. An
identifier lookup, an AI-assisted image conversion, or a provider-backed
refinement can make a network request. The tool panel names that requirement
before it runs.

## Validate

| ID | Tool | What it does | Slash aliases |
| --- | --- | --- | --- |
| `bibtex` | BibTeX Validator | Check `.bib` files for syntax errors, missing required fields, and duplicate keys. | `/bibtex-validator`, `/bibtex` |

## Research

| ID | Tool | What it does | Slash aliases |
| --- | --- | --- | --- |
| `lab-search` | Lab Search | Find research institutions through the OpenAlex directory, with country and ROR links. | `/lab-search`, `/institution-search` |
| `deadlines` | Conference Deadlines | Search computer science conference deadlines with field filters and countdowns. | `/conference-deadlines`, `/deadlines` |

## References

| ID | Tool | What it does | Slash aliases |
| --- | --- | --- | --- |
| `literature-search` | Find Citations | Search scholarly indexes, scan a draft, combine duplicate results, and export BibTeX. | `/find-citations`, `/citations-search`, `/citation-search`, `/literature-search` |
| `arxiv-citation-generator` | arXiv Citation Generator | Look up an arXiv paper and export its citation in eight styles. | `/arxiv-citation`, `/cite-arxiv` |
| `bibliography-generator` | Bibliography Generator | Build, validate, sort, and export a bibliography from structured details or BibTeX. | `/bibliography-generator`, `/make-bibliography` |
| `citation-generator` | Citation Generator | Turn article details or a scholarly identifier into a formatted citation and BibTeX. | `/citation-generator`, `/make-citation` |
| `citation-styles` | Citation Generators by Style | Compare one reference across APA, MLA, Chicago, IEEE, Harvard, Vancouver, AMA, and ACS. | `/citation-styles`, `/citation-style-generator` |
| `doi-to-bibtex` | DOI to BibTeX | Retrieve a DOI record, review its fields, and export clean BibTeX. | `/doi-to-bibtex`, `/doi-citation` |
| `isbn-to-bibtex` | ISBN to BibTeX | Retrieve book metadata from an ISBN, correct it, and export BibTeX. | `/isbn-to-bibtex`, `/isbn-citation` |
| `pubmed-to-bibtex` | PubMed to BibTeX | Retrieve and review a PubMed record from its PMID, then export BibTeX. | `/pubmed-to-bibtex`, `/pmid-to-bibtex` |
| `url-to-bibtex` | URL to BibTeX | Recognize DOI, arXiv, and PubMed links or build an editable webpage citation. | `/url-to-bibtex`, `/webpage-citation` |
| `symbols` | Symbol Reference | Browse LaTeX symbols and insert one at the current cursor. | `/symbols`, `/cheatsheet`, `/greek-letters` |

Identifier lookups and scholarly searches use the configured services. Manual
entry and local formatting remain available when a lookup is unavailable.

## Statistics

| ID | Tool | What it does | Slash aliases |
| --- | --- | --- | --- |
| `stats` | Statistics Calculators | Calculate p-values, sample sizes, and confidence intervals locally. | `/stats`, `/statistics`, `/p-value` |

## Write

| ID | Tool | What it does | Slash aliases |
| --- | --- | --- | --- |
| `generators` | Writing Generators | Draft an abstract, summary, paraphrase, or thesis outline with the assistant. | `/generators`, `/abstract`, `/paraphrase` |

Writing generators need a configured assistant provider. The result is text
you can review, copy, or save. It does not silently change the open project.

## Command palette and slash commands

The command palette searches projects, documents, commands, and all catalogued
tools in one place. It also includes recompile, auto-compile, SyncTeX, PDF
export, cache cleanup, word count, Git history, checkpoints, terminal,
citations, formatting helpers, environment helpers, themes, Vim mode,
spellchecking, and offline mode.

<div align="center">
  <img src="assets/readme/command-palette.png" alt="Oleafly command palette searching projects, documents, commands, and tools" width="100%" />
</div>
<p align="center"><em>Search the workspace and open a tool without leaving the manuscript.</em></p>

See [Keyboard shortcuts](KeyboardShortcuts.md) for the default keys and
[MCP integration](mcp.md) for the project tools exposed to external clients.
