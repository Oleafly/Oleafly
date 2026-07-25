# Research workflows

Oleafly supports papers, theses, reports, books, posters, presentations, grant
drafts, technical notes, and research CVs. These are normal Oleafly projects,
not a separate Research Mode with different storage or behavior.

## Build a multi-file project

Start from a publication, thesis, report, poster, presentation, or blank
template. A project can contain nested source files, bibliographies, images,
generated figures, and other assets. Choose the main document explicitly when
the project has more than one possible entry point.

For LaTeX projects, Oleafly understands `\input` and `\include` relationships
and indexes labels, references, citation keys, macros, environments, and the
file graph across the project.

## Navigate and revise

Code intelligence works across files:

- go to definitions for labels, citations, macros, and environments
- find references across the project
- rename labels, citation keys, and macros with clash detection
- keep the source and rendered PDF aligned with bidirectional SyncTeX
- search project content and structure

The Code and Visual editors share the same undo history. LaTeX constructs that
the Visual editor cannot render remain editable as explicit raw blocks.

## Manage citations and literature

Add references from a DOI, arXiv identifier, URL, or Crossref title search.
Oleafly appends a BibTeX entry, deduplicates it by DOI, and can insert the
corresponding citation at the cursor.

Optional research connectors can search literature and retrieve paper metadata.
Those lookups use external services and therefore require a network connection;
ordinary editing, cached compilation, and local project search do not.

## Create figures and diagrams

Use the Diagram Composer to draw a figure visually or edit its TikZ source with
a live preview. Diagrams can be inserted as editable vector code or saved as an
image while preserving their source.

With an AI provider configured, the assistant can draft and refine figures in
an isolated compile workflow. Without AI, the visual and code-based diagram
tools remain available locally.

## Compile, review, and preserve history

Oleafly compiles supported document engines locally and keeps the generated PDF
beside a real Git history. Automatic commits, diffs, restore, and optional
GitHub synchronization make it possible to review changes throughout a paper or
thesis rather than managing numbered copies.

Preflight checks references, citations, included files, assets, extracted text,
reading order, and document metadata before submission. Conference deadlines
are available as a separate library tool with a bundled offline snapshot and an
on-demand community-data refresh.

## Work with optional AI

The assistant can read the whole project map, edit files, compile, inspect logs,
and extract PDF text to verify an accepted change. Every file-changing action
requires approval. You can use a hosted provider, run a supported local model,
or leave AI disabled.

## Related guides

- [Features](features.md)
- [Getting started](getting-started.md)
- [AI Assistant](ai-assistant.md)
- [GitHub Sync](github-sync.md)
- [Document engines](document-engines.md)
