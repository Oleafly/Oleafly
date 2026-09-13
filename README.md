<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](docs/readme-translations/README.de.md) | **English** | [Español](docs/readme-translations/README.es.md) | [Français](docs/readme-translations/README.fr.md) | [日本語](docs/readme-translations/README.ja.md) | [한국어](docs/readme-translations/README.ko.md) | [Português](docs/readme-translations/README.pt.md) | [Русский](docs/readme-translations/README.ru.md) | [中文](docs/readme-translations/README.zh.md) | [العربية](docs/readme-translations/README.ar.md)

[![Download Oleafly](https://img.shields.io/badge/Download_free_for_macOS%2C_Windows%2C_Linux-22c55e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Oleafly/Oleafly/releases/latest) [![View source](https://img.shields.io/badge/View_source-111827?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Oleafly/Oleafly)

[![Open issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml) [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE) [![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**Research, write, compile, verify, and publish from one desktop workspace.**

Oleafly is a free, open-source app for people who write papers, theses, reports, presentations, books, resumes, and technical documents. Work in LaTeX, Typst, or Markdown. Keep the source, PDF, citations, figures, checks, Git history, and optional AI assistance close to the work itself.

<p>
  <a href="https://github.com/Oleafly/Oleafly/releases/latest"><strong>Download free</strong></a>
· <a href="https://oleafly.com/docs/">Read the guides</a> · <a href="docs/development.md">Build from source</a>
</p>

<br />

No tracking · No mandatory account · No subscription · Your files stay yours

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-light-bg.png" alt="Oleafly editing a research paper in LaTeX with the source tree, document outline, and compiled PDF open together" width="100%" />
</div>

## Start here

| If you are... | Start with... |
| --- | --- |
| Writing a paper or thesis | An editable LaTeX, Typst, or Markdown starter |
| Bringing existing work onto your computer | A ZIP, GitHub repository, Word or HTML file, Typst document, arXiv source, or PDF import |
| Working in LaTeX, Typst, or Markdown | The source editor, visual editor, live preview, and engine picker |
| Building a structured manuscript | The project outline, cross-file search, reference navigation, and local proofing |
| Finding sources or citations | Citation Search, a document support scan, or a local bibliography import |
| Working with AI | The built-in assistant, isolated Research Tasks, a CLI agent, or MCP |
| Running a longer research task | A separate worktree or staged copy, reviewed results, and selective file application |
| Reusing a research workflow | The bundled skill pack, slash commands, or a saved skill folder |
| Building a figure or table | Diagram Composer, LaTeX Preview, Image to LaTeX, or LaTeX Table Generator |
| Preparing a submission | Preflight for compile, references, privacy, accessibility, and venue checks |
| Recovering or versioning work | Checkpoints for local recovery and Git for intentional history and collaboration |
| Linking papers, data, or analysis | Read-only linked research folders beside the manuscript |
| Exporting or converting documents | PDF and source ZIPs, plus supported Word, HTML, Markdown, text, PPTX, or EPUB outputs |
| Looking for a local toolchain | Bundled Tectonic and Typst, with optional system TeX and Pandoc |

## The short version

Most research-writing workflows are a chain of separate tools: an editor, a compiler, a PDF reader, a bibliography manager, a diagram tool, Git, a review checklist, and perhaps an AI chat that cannot see the project. The work gets spread across windows just when the argument is getting complicated.

Oleafly puts those pieces around the same project. The source remains editable source. The PDF stays beside it. The assistant can inspect the real files when you ask it to. A citation can be found from the sentence you are writing. A figure can stay as TikZ instead of becoming a dead image. A proposed edit can be reviewed before it touches the project.

### Three ways to work

| Workflow | What it gives you | What you still have to solve |
| --- | --- | --- |
| Hosted cloud editor | Fast setup, browser access, and a managed service | Trusting a hosted data layer and fitting your workflow into its limits |
| DIY local stack | Control over files, tools, and infrastructure | Choosing, installing, configuring, and maintaining every piece yourself |
| Oleafly | A local desktop workspace with the editor, engines, PDF, citations, figures, checks, Git, and optional agents together | Live co-editing and background device sync are not shipped in this release |

The point is simple: keep the convenience of a guided workspace without making your manuscript depend on a proprietary document format or a permanent service in the middle.

## A local workspace with clear boundaries

Oleafly does not need an account for core writing. Project files, indexing, compilation with an available local engine, PDF preview, spellchecking, grammar checking, preflight, Git history, checkpoints, and the terminal stay on your machine unless you choose an integration.

Network access is explicit. Literature lookup, DOI metadata, GitHub operations, hosted AI, optional engine and template downloads, and update feeds are the operations that can reach the network. Local Ollama models keep model traffic on your computer. The app shows unavailable or offline states instead of quietly pretending that an online feature worked.

| Stays local by default | Happens only when you choose it |
| --- | --- |
| Project source and metadata | Literature and citation lookup |
| Editor state and project index | GitHub sign-in, push, pull, and publish |
| LaTeX compilation with the bundled engine when packages are available | Hosted AI providers |
| Typst compilation | Optional downloads and update checks |
| PDF rendering and text inspection | Domain-shelf skill downloads |
| Spellchecking, grammar checking, and preflight | External MCP clients on localhost |
| Git history and automatic checkpoints | |

<p align="center">
  <img src="https://placehold.co/1600x900/0f172a/e2e8f0?text=Screenshot+needed%3A+local+data+and+integration+boundaries" alt="Placeholder for a screenshot of Oleafly's local-first and integration settings" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Settings showing local project storage, offline mode, provider boundaries, and integration controls.</em></p>

## Begin with a real project

### Templates that produce editable files

Start with an article, journal paper, thesis, literature review, report, book, Beamer presentation, poster, assignment, letter, bibliography, resume, or diagram. Templates are normal source projects with a declared engine, main document, document kind, assets, and preview metadata. You can inspect the files before creating the project.

The gallery filters by engine, category, offline readiness, and ATS suitability. Bundled templates work without a template account. Optional template packs, fonts, and assets download only after you select them.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/document-starters-dark-window-v1.png" alt="The Oleafly template gallery with document previews and project starters" width="100%" />
</div>

### Bring the work you already have

Import a project ZIP or GitHub repository, bring in a DOCX through Pandoc, or use a PDF as the starting point for editable LaTeX. Imports become local project files, so the original source remains untouched while you inspect the result.

PDF reconstruction is deterministic. It extracts the text, layout, equations, and figures it can identify, reports its limits, and leaves you with editable LaTeX rather than an opaque document. If you connect a vision-capable provider, it can help refine an imported project afterward.

<p align="center">
  <img src="https://placehold.co/1600x900/1e293b/e2e8f0?text=Screenshot+needed%3A+import+and+reconstruction+flow" alt="Placeholder for a screenshot of the PDF, DOCX, ZIP, and repository import flow" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Import chooser, compatibility scan, editable source preview, and the resulting local project.</em></p>

### Projects are ordinary folders

Oleafly's library tracks project identity, engine, document kind, bookmarks, preview state, and history. The manuscript itself remains a normal directory. The source can be opened in another editor, inspected in a terminal, shared with a coauthor, or committed with ordinary Git. Oleafly does not require a proprietary document database to compile your work.

The app keeps its own build artifacts and local metadata separate from the source. A project can carry its engine and main-document choices in `project.json`, so a clone or exported source archive has a portable starting point.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/project-library-dark-window-v1.png" alt="Research papers organized as projects in the Oleafly library" width="100%" />
</div>

## Write the paper without losing the structure

### A source editor that understands documents

The CodeMirror editor is backed by a project-wide index. It knows about headings, labels, citation keys, macros, environments, included files, and compile diagnostics instead of treating a long manuscript as one unstructured text area.

In LaTeX, Typst, Markdown, and BibTeX you get:

- Engine-aware syntax highlighting for commands, environments, math, comments, markup, and bibliography entries.
- Completion for LaTeX commands, environments, labels, citation keys, and project file paths.
- Live diagnostics for syntax, compile errors, undefined citations, duplicate keys, duplicate labels, and broken references.
- A local and global document outline with symbols, labels, citations, macros, and file relationships.
- Search and replace, code folding, multi-file tabs, Vim mode, word count, slash-command insertion, and configurable keyboard shortcuts.
- LaTeX structural helpers for `\\item`, `\\begin` / `\\end`, environments, math delimiters, captions, and common insertion patterns.
- Hovers for compiled label numbers and pages, equation previews, and image thumbnails for `\\includegraphics` targets.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/manuscript-writing-dark-window-v1.png" alt="Oleafly showing a research paper with its LaTeX source and compiled PDF together" width="100%" />
</div>

### Source view and visual view

Source view is the canonical representation. When the engine supports it, turn on the visual editor for LaTeX or Markdown and edit prose, equations, citations, tables, and figures in a more document-like surface. The source is still there, readable and ready for Git, external editors, or a future manual edit.

Use the visual view when you want to think about the page. Switch back to source when you want exact control over commands, packages, environments, or layout.

<p align="center">
  <img src="https://placehold.co/1600x900/172554/dbeafe?text=Screenshot+needed%3A+visual+and+source+editor+toggle" alt="Placeholder for a screenshot of Oleafly's source and visual editor views" width="100%" />
</p>
<p align="center"><em>Screenshot needed: The same LaTeX manuscript shown in source view and visual view, with the toggle and an equation or citation visible.</em></p>

### Proofread prose locally

Hunspell handles spelling with the selected dictionary pack and personal or project additions. Harper checks grammar and style through a document-aware prose mask, so commands, comments, math bodies, and machine arguments are not treated as ordinary English sentences.

The academic profile avoids rules that fight scholarly writing, and every finding has a local action: replace it, ignore it for the project, ignore it for the session, or adjust the rule in Settings. Proofreading runs locally and does not require an AI provider.

<p align="center">
  <img src="https://placehold.co/1600x900/3f1d3b/fce7f3?text=Screenshot+needed%3A+local+proofreading+findings" alt="Placeholder for a screenshot of local spelling and grammar findings in a manuscript" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Inline spelling and grammar findings in LaTeX prose, with the academic profile and ignore controls visible.</em></p>

### Search the project, not just the current file

Search across the project from the rail or command palette. The project index connects source files, headings, labels, citations, macros, and included files, so a large multi-file thesis is easier to navigate than a stack of editor tabs.

<p align="center">
  <img src="https://placehold.co/1600x900/082f49/cffafe?text=Screenshot+needed%3A+file+tree%2C+outline%2C+and+project+search" alt="Placeholder for a screenshot of the file tree, document outline, and project search" width="100%" />
</p>
<p align="center"><em>Screenshot needed: File tree, project search results, document outline, and a cross-file reference open together.</em></p>

## Compile with the toolchain that fits the project

Oleafly keeps compilation close to the manuscript and turns compiler output into source-linked diagnostics. The engine is chosen per project, and the editor, preview, SyncTeX, preflight, and export controls follow the engine's actual capabilities.

| Engine | What it is good for | Important details |
| --- | --- | --- |
| LaTeX with Tectonic | Portable, bundled LaTeX builds | Ships with the desktop app; supports multi-file projects, images, citations, Biber, SyncTeX, isolated figure compilation, and cached offline builds when packages are available |
| LaTeX with `latexmk` | Projects that need a full system TeX distribution | Uses MacTeX, TeX Live, MiKTeX, or TinyTeX; supports `minted`, `glossaries`, `makeidx`, PythonTeX, shell-escape-heavy templates, and Unicode engines when explicitly trusted |
| Typst | Fast modern document authoring | Bundled compiler, PDF output, project indexing, and citations; SyncTeX, offline compiler mode, and isolated figure compilation are not available in this release |
| Markdown with Pandoc | Lightweight prose and conversion workflows | Pandoc can be installed from Settings; PDF output uses the bundled Tectonic input, with DOCX, HTML, Markdown, and text exports where supported |

LaTeX projects get a compatibility scan when they open. If a project needs more than the bundled engine can orchestrate, Oleafly explains the gap and offers the appropriate engine or package path. System TeX runs with restricted shell commands by default; full shell escape is a separate trust decision for one project on one computer.

The bundled Biber sidecar is matched to the Tectonic biblatex version. Compile logs distinguish a missing Biber executable, a version mismatch, and an ordinary LaTeX error instead of sending you to the wrong fix.

<p align="center">
  <img src="https://placehold.co/1600x900/312e81/e0e7ff?text=Screenshot+needed%3A+engine+picker+and+compile+diagnostics" alt="Placeholder for a screenshot of engine selection and compile diagnostics" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Project engine picker, compatibility explanation, compile log, and a source-linked error.</em></p>

## Read the PDF beside the source

The PDF viewer is built into the workspace and can also open in a detached preview window. It keeps the last accepted PDF visible while a newer compile is running or has failed, so one broken edit does not erase the last readable result.

Use continuous scroll or a one-page / two-page spread. Zoom, fit to width, fit to height, rotate, invert colors, search the document text, follow the outline, jump to a page, download with a chosen filename, or inspect the compile log in the same surface. Encrypted PDFs get a password prompt rather than a blank viewer.

When valid SyncTeX data exists, forward navigation moves from source to PDF and inverse navigation moves from a PDF click back to the source line. Engines that do not support SyncTeX say so instead of displaying a dead control.

<p align="center">
  <img src="https://placehold.co/1600x900/111827/e5e7eb?text=Screenshot+needed%3A+PDF+reader+controls+and+SyncTeX" alt="Placeholder for a screenshot of the PDF preview, page controls, and source navigation" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Two-page PDF view, outline, search, zoom controls, compile status, and a SyncTeX jump from source to output.</em></p>

## Find, understand, and manage the literature

### Search from the sentence you are writing

Citation Search queries arXiv, Semantic Scholar, Crossref, PubMed, and OpenAlex together. It combines duplicate results, keeps the metadata visible, and lets you save a reference to the local literature library.

You can also look up a citation by DOI, arXiv ID, URL, or title. Import an existing library from Zotero RDF, EndNote XML, RIS, or BibTeX. The project index provides citation-key completion, reference navigation, hover details, and diagnostics for undefined citations, duplicate keys, duplicate DOIs, and incomplete bibliography metadata.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/literature-discovery-dark-window-v1.png" alt="Search results from scholarly indexes in Oleafly" width="100%" />
</div>

### Scan the document for missing support

From document mode splits the current selection or manuscript into prose paragraphs, searches configured literature sources, filters out papers already represented in the bibliography, and ranks suggestions with a 0–100 score. With an AI provider, a result can include short FOR / AGAINST reasoning. With AI off, the scan falls back to local heuristic ranking.

Save results to the local citation library, copy BibTeX, or append a selected entry to a project bibliography and insert its citation.

<p align="center">
  <img src="https://placehold.co/1600x900/0c4a6e/e0f2fe?text=Screenshot+needed%3A+From+document+citation+scan" alt="Placeholder for a screenshot of paragraph-level citation suggestions" width="100%" />
</p>
<p align="center"><em>Screenshot needed: A manuscript paragraph, ranked citation suggestions, score badges, bibliography filtering, and the insert-citation action.</em></p>

### Review a paper in two voices

Review mode can use a configured AI provider to read the current document or a captured selection in two styles:

- Friendly: strengths first, then specific and constructive suggestions.
- Fire: a strict Reviewer #2 stress-test of claims, methods, and evidence.

The review is an optional assistant action. It is not a substitute for the venue's guidelines or a human coauthor.

<p align="center">
  <img src="https://placehold.co/1600x900/450a0a/fee2e2?text=Screenshot+needed%3A+Friendly+and+Fire+review+mode" alt="Placeholder for a screenshot of Oleafly's Friendly and Fire review modes" width="100%" />
</p>
<p align="center"><em>Screenshot needed: The same manuscript reviewed in Friendly and Fire modes, with evidence-linked findings and the provider status visible.</em></p>

### Keep research folders beside the manuscript

Link a dataset, source library, analysis folder, or other research directory without moving it into the project. Oleafly reads linked folders and never writes to them. They stay out of compilation, project search, and Git, with clear missing and unreadable states when a path is unavailable.

<p align="center">
  <img src="https://placehold.co/1600x900/14532d/dcfce7?text=Screenshot+needed%3A+read-only+linked+research+folders" alt="Placeholder for a screenshot of linked read-only research folders" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Linked folders labeled References, Data, Analysis, and Manuscript, with read-only state and file preview.</em></p>

### Search labs and deadlines

The tools gallery includes Lab Search for research institutions listed by OpenAlex, with country filters and links to institutional, ROR, and OpenAlex records. Conference Deadlines provides searchable fields and countdowns for computer science venues from the bundled deadline data.

## Make figures, equations, and tables that stay editable

### Diagram Composer

Draw a figure on a canvas with rectangles, circles, ellipses, diamonds, text, connectors, snapping, fill and border colors, undo, redo, a minimap, and a light or dark canvas. Switch to TikZ code, insert snippets, compile the figure in isolation, and preview it beside the source.

The saved `.tikz` source keeps the diagram model for another edit. Insert the result as TikZ or as a generated image, with a caption and label. Optional AI repair can help with figure compile errors, and a vision-capable model can inspect a render and refine its layout.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/figure-workshop-dark-window-v1.png" alt="The diagram workspace with editable source and a rendered figure" width="100%" />
</div>

### Small tools that save a surprising amount of time

| Tool | Use it for |
| --- | --- |
| PDF to LaTeX | Reconstruct editable LaTeX from a PDF, with math, figures, and structure preserved where the source allows it |
| LaTeX Preview | Render equations, matrices, aligned math, cases, series, limits, and chemistry, then copy the LaTeX |
| Image to LaTeX | Transcribe an equation, table, or visible text from an image with a configured vision-capable provider |
| LaTeX Table Generator | Edit rows, columns, alignment, captions, headers, and booktabs rules visually, then copy the source |
| BibTeX Validator | Check syntax, required fields, entry types, and duplicate citation keys before compilation |

Equation previews can also export PNG, SVG, MathML for Word, or KaTeX HTML. Table output remains ordinary LaTeX. The tools are available from the gallery, the command palette, and slash commands where shown in the app.

<p align="center">
  <img src="https://placehold.co/1600x900/581c87/f3e8ff?text=Screenshot+needed%3A+Oleafly+Tools+gallery" alt="Placeholder for a screenshot of the Oleafly Tools gallery" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Tools gallery with PDF to LaTeX, equation preview, BibTeX validation, table generation, and slash-command search.</em></p>

## Check the document before it leaves your machine

Preflight reads the source, project structure, compiler log, and current PDF. It groups findings by what went wrong and tells you where the evidence came from. Checks can run together or separately, and a missing input is reported as unavailable or partial rather than counted as a pass.

| Check | What it looks for |
| --- | --- |
| Compile and layout | Failed builds, unresolved citations and references, rerun warnings, missing glyphs, overfull boxes, clipped text, duplicate PDF destinations, and mixed page sizes |
| Submission readiness | Document class, abstract, keywords, figure formats, embedded fonts, PDF version and restrictions, portable filenames, captions, and clean source packaging |
| ATS readiness | Resume text extraction, contact fields, expected sections, page length, and layouts that commonly scramble applicant-tracking systems |
| Accessibility | Tags, alt text, document language and title, viewer settings, heading and table structure, link descriptions, reading order, selectable text, bookmarks, and very small text |
| References and assets | Missing files, undefined citations and cross-references, duplicate labels and DOIs, incomplete bibliography fields, uncited entries, and missing figures |
| Privacy and blind review | Credentials, private keys, sensitive files, draft markup, internal comments, author fields, acknowledgements, and PDF identity metadata |

Publication profiles cover general publication, arXiv, IEEE, ACM, other journals, and theses. You still need the venue's current author guide for its exact margins, page limits, file-size rules, and submission instructions.

The accessibility lens cites PDF/UA, Matterhorn, and WCAG references and reports the machine-checkable part of PDF/UA-1. Accessible export preparation can add LaTeX metadata, table-header declarations, and alt-text placeholders where the active class and packages support them.

Preflight is a serious second pair of eyes, not a conformance certificate. It cannot decide whether alt text is meaningful, whether reading order makes sense, or whether contrast is sufficient. For a formal accessibility conformance statement, validate the final PDF with the venue's required tool.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/submission-checks-dark-window-v1.png" alt="Preflight checks for a research paper before submission" width="100%" />
</div>

## Version the work your way

### Git is real Git

Oleafly works with a normal Git repository. The Source Control panel can initialize a repository, show unified or side-by-side diffs, stage files, discard changes, commit, push, pull, and show ahead or behind state for a remote. You can also publish a project to GitHub or connect an existing repository.

Saving, compiling, or closing a project never creates a commit. Oleafly does not hide the source from your terminal or edit the project's `.gitignore` just to make its own metadata disappear.

<p align="center">
  <img src="https://placehold.co/1600x900/164e63/cffafe?text=Screenshot+needed%3A+Git+source+control+panel" alt="Placeholder for a screenshot of Git status, diffs, staging, and commit controls" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Changed files, inline or split diff, stage controls, commit message, and remote ahead / behind status.</em></p>

### Checkpoints are separate from Git

After a successful compile, Oleafly can save a local snapshot of the project. Checkpoints do not initialize a repository, create commits, or change a branch. Restore a previous state transactionally, label an important version, inspect stored files, trim old history, or move a complete history in an encrypted archive.

That gives you two useful kinds of history:

- Git for intentional commits, branches, remotes, and collaboration.
- Checkpoints for quick local recovery while a paper is changing fast.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/project-history-dark-window-v1.png" alt="Saved project checkpoints in Oleafly" width="100%" />
</div>

## Use AI when it helps, and keep control when it matters

The editor, compiler, PDF preview, citations, proofing, and preflight work with AI turned off. AI is an optional layer over the same project operations, not a second document model that hides the files from you.

### The built-in assistant sees the project you mean

With a configured provider, the assistant can:

- Read a project file or search the project before answering.
- Explain a section, equation, citation, or compile error.
- Revise prose, create files, rename files, and make targeted replacements.
- Compile the project, read the log, extract PDF text, and inspect rendered pages when the PDF capture setting is enabled.
- Search literature, verify a DOI, add a citation, and map the document's headings, labels, citations, macros, and file relationships.
- Draft, compile, inspect, repair, and insert editable TikZ or PGFPlots figures.

File-changing actions produce a visible diff. Approval policies can ask every time, approve ordinary writes for a session, or keep the assistant in a more hands-off mode that you choose in Settings. Plan mode lets it read and map the work before writes, compilation, or commands become available.

Bring a hosted provider, an OpenAI-compatible endpoint, or a local Ollama model. Provider credentials live in encrypted app-managed storage and are not written into project files. Hosted calls are opt-in; the request boundary is shown by the action you choose.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/assistant-at-work-dark-window-v1.png" alt="The AI assistant working alongside the open research project" width="100%" />
</div>

<details>
<summary>Review an edit before it is applied</summary>

In Ask for approval mode, read the proposed file diff and decide what reaches the project. Ordinary writes can be approved for the session; deletes remain separately visible and can require an explicit confirmation.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/review-an-edit-dark-window-v1.png" alt="Approval controls for reviewing the assistant's proposed changes" width="100%" />
</div>

</details>

### Research Tasks keep longer work out of your way

Give a task a literature review, evidence audit, analysis, manuscript revision, or response to reviewers. It works in a separate Git worktree or staged copy while you continue in the original project.

When the task finishes, inspect activity, outputs, and every changed file. Preview the diff, select the files worth keeping, and apply only those files. The original project stays unchanged until you apply reviewed results. If the project changed while the task was running, Oleafly detects the drift instead of applying an old diff over newer work.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/research-review-dark-window-v1.png" alt="The research workspace for tasks that run alongside the manuscript" width="100%" />
</div>

### Bring the CLI agent you already use

Oleafly's built-in catalog currently includes these 14 CLI agents. Each uses its own account, permissions, and model configuration; Oleafly supplies the project context and the surrounding workspace.

| Agent | Command |
| --- | --- |
| <img src="https://cdn.simpleicons.org/anthropic" alt="" width="24" height="24" /> Claude Code | `claude` |
| <img src="https://api.iconify.design/logos:openai-icon.svg" alt="" width="24" height="24" /> Codex CLI | `codex` |
| <img src="https://cdn.simpleicons.org/googlegemini" alt="" width="24" height="24" /> Gemini CLI | `gemini` |
| <img src="https://pi.dev/favicon.svg" alt="" width="24" height="24" /> Pi | `pi` |
| <img src="https://cdn.simpleicons.org/opencode" alt="" width="24" height="24" /> OpenCode | `opencode` |
| <img src="https://openclaw.ai/favicon.svg" alt="" width="24" height="24" /> OpenClaw | `openclaw` |
| <img src="https://cdn.simpleicons.org/cline" alt="" width="24" height="24" /> Cline | `cline` |
| <img src="https://hermes-agent.nousresearch.com/favicon.ico" alt="" width="24" height="24" /> Hermes Agent | `hermes` |
| <img src="https://cdn.simpleicons.org/codebuddy" alt="" width="24" height="24" /> CodeBuddy | `codebuddy` |
| <img src="https://cdn.simpleicons.org/kimi" alt="" width="24" height="24" /> Kimi Code | `kimi` |
| <img src="https://grok.com/images/favicon.svg" alt="" width="24" height="24" /> Grok Build | `grok` |
| <img src="https://cdn.simpleicons.org/cursor" alt="" width="24" height="24" /> Cursor | `agent` |
| <img src="https://cdn.simpleicons.org/deepseek" alt="" width="24" height="24" /> DeepSeek Harness | `dsh` |
| <img src="https://qoder.com/favIcon.svg" alt="" width="24" height="24" /> Qoder | `qodercli` |

<small>These marks identify compatible tools and remain the property of their respective owners. They do not imply endorsement.</small>

Open a conversation, sign in through the agent's own CLI when required, reconnect, watch tool activity, steer a running turn at a safe point, stop it, and keep the transcript with the project session where supported.

CLI agent support is in beta. Install readiness, platform limits, and resume support are shown per agent in Settings rather than guessed from its name.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/cli-agents-dark-window-v1.png" alt="CLI agents connected to the Oleafly assistant" width="100%" />
</div>

### Skills turn a one-off prompt into a workflow

Oleafly ships a research skill pack with stages for literature work, authoring, figures, review, submission, communication, and tooling. Skills are ordinary `SKILL.md` folders that follow the Agent Skills shape.

Use a skill with a slash command, add your own folder, record a repeatable workflow from a completed chat, or install a domain skill from the shelf when you choose to download one. Skills can be shared with compatible CLI agents on the same computer. A skill already installed keeps working offline.

<p align="center">
  <img src="https://placehold.co/1600x900/422006/fef3c7?text=Screenshot+needed%3A+skills+and+repeatable+research+workflow" alt="Placeholder for a screenshot of Oleafly's skills shelf and saved workflow" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Skills shelf, slash-command invocation, saved workflow, and the local folder used by a repeatable research task.</em></p>

### Use Oleafly from another AI client with MCP

Oleafly can run a local MCP server for an external client. It exposes the same project tools as the built-in assistant: list and read files, search the project, inspect its map, compile, read the log, extract PDF text, preview figures, and apply edits subject to Oleafly's approval policy.

The server binds to `127.0.0.1` only, uses a short-lived bearer token, and runs only while the Oleafly process is open. A read-only mode removes mutating tools from the advertised tool list. The external client brings its own model, so you do not need to put an AI API key into Oleafly for this route.

<p align="center">
  <img src="https://placehold.co/1600x900/1c1917/fef3c7?text=Screenshot+needed%3A+MCP+settings+and+approval+flow" alt="Placeholder for a screenshot of local MCP connection details and approvals" width="100%" />
</p>
<p align="center"><em>Screenshot needed: MCP toggle, live localhost URL, bearer-token controls, read-only mode, and an external request awaiting approval.</em></p>

## Tools for the work around the manuscript

The Oleafly Tools gallery is searchable by name, description, and slash command. It is also available through the omnibar and command palette.

| Tool | What it does |
| --- | --- |
| PDF to LaTeX | Convert a PDF into editable LaTeX with deterministic reconstruction |
| LaTeX Preview | Render math and copy LaTeX, SVG, PNG, MathML, or KaTeX HTML |
| BibTeX Validator | Find parse errors, missing required fields, entry-type issues, and duplicate keys |
| LaTeX Table Generator | Build a table visually and export ordinary LaTeX |
| Citation Search | Search literature manually or scan the document for suggested support |
| Lab Search | Find institutions and inspect OpenAlex records |
| Conference Deadlines | Filter computer science deadline data and view countdowns |
| Diagram Composer | Draw, edit, compile, and save TikZ figures |

The command palette also gives you recompile, auto-compile, SyncTeX, PDF export, clear build cache, word count, Git history, checkpoints, terminal, citation insertion, formatting helpers, environment helpers, theme controls, Vim mode, spellchecking, and offline mode.

## A terminal beside the paper

Open shell tabs for the active project without leaving the workspace. Up to ten terminal sessions can be open per project. Rename and color tabs, close one or several sessions, and keep those tab labels with the project.

This is useful for running a script, checking a dataset, inspecting a generated file, or using a tool that is not part of Oleafly's UI. It is still your shell, with the same project directory available to the commands you choose to run.

<p align="center">
  <img src="https://placehold.co/1600x900/0f172a/a7f3d0?text=Screenshot+needed%3A+terminal+dock+beside+the+editor" alt="Placeholder for a screenshot of the terminal dock beside a manuscript" width="100%" />
</p>
<p align="center"><em>Screenshot needed: A named terminal tab running a project command beneath the editor and PDF preview.</em></p>

## Research in the browser, when you need it

The optional in-app browser opens remote pages in a separate window with tabs, an address bar, navigation controls, and isolated content webviews. It is a convenient place to read a paper, inspect an institutional page, or follow a source while keeping the manuscript in the main workspace.

Remote pages do not receive Oleafly IPC access. The browser is an integration, not a claim that every research source is available offline.

<p align="center">
  <img src="https://placehold.co/1600x900/1f2937/e5e7eb?text=Screenshot+needed%3A+in-app+research+browser" alt="Placeholder for a screenshot of the in-app research browser" width="100%" />
</p>
<p align="center"><em>Screenshot needed: Browser tabs showing a paper or lab page, with the protected app toolbar and the manuscript still available in the main window.</em></p>

## Built for the way research actually moves

| Use case | How Oleafly helps |
| --- | --- |
| First paper | Start from an article template, write with the outline visible, and compile as you go |
| Thesis or dissertation | Keep chapters, figures, references, and appendices in one indexed project with checkpoints for recovery |
| Literature review | Search sources, scan paragraphs for missing support, save metadata, and organize evidence with research skills |
| Reproducible analysis | Link data and analysis folders read-only, keep the manuscript separate, and use the terminal for project commands |
| Conference paper | Use venue-oriented templates, SyncTeX, figure and table tools, and a pre-submission pass |
| Beamer talk or poster | Start from a presentation or poster template and export supported formats from the project |
| Book or long report | Use a multi-file source tree, outline, project-wide references, PDF navigation, and EPUB export where supported |
| Resume or CV | Use resume templates, local proofing, PDF text extraction, and ATS readiness checks |
| Multilingual manuscript | Choose the template's Unicode engine and system fonts when the project needs XeLaTeX or LuaLaTeX |
| Lab or team assistant | Use isolated Research Tasks, a CLI agent, or the localhost MCP server with approval controls |

## Download Oleafly

<div align="center">

[![Download the latest release](https://img.shields.io/badge/Download_the_latest_release-22c55e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Oleafly/Oleafly/releases/latest)

</div>

Free Forever, Open Source, No Accounts, No Signups, and No Tracking.

| Platform | Package |
| --- | --- |
| macOS · Apple Silicon | DMG |
| Windows · x86_64 | MSI or EXE |
| Linux · x86_64 | AppImage or DEB |
| Linux · ARM64 | AppImage or DEB |

The desktop app includes Tectonic for LaTeX and a Typst compiler. LaTeX can build offline when the required packages are already available to the bundled engine. Pandoc can be installed from Settings for Markdown conversions.

Linux packages require glibc 2.39 or newer. Releases include signed update artifacts, and the in-app updater checks the signature before installation. The [release notes](https://github.com/Oleafly/Oleafly/releases/latest) say what is included in each installer.

## Learn more

- [Product guides](https://oleafly.com/docs/)
- [Feature map](docs/features.md)
- [Editor guide](docs/Editor.md)
- [PDF preview](docs/PDFPreview.md)
- [Citations and literature](docs/Citations.md)
- [Preflight and accessibility checks](docs/Preflight.md)
- [Templates](docs/Templates.md)
- [Diagram Composer](docs/DiagramComposer.md)
- [Git and source control](docs/SourceControl.md)
- [Checkpoints](docs/Checkpoints.md)
- [AI Copilot](docs/AICopilot.md)
- [Skills](docs/Skills.md)
- [MCP integration](docs/mcp.md)
- [Development setup](docs/development.md)

## Honest boundaries

Oleafly is in beta. The current desktop release does not provide live co-editing, comments, or background project sync across devices. Typst and Markdown do not currently provide SyncTeX or the LaTeX-specific source preflight checks. Review the active engine's capability state in the app and read the [changelog](CHANGELOG.md) as the project evolves.

## Community and support

Bring questions, ideas, and research workflows to [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions). Report a bug or request a feature in [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).

Oleafly is built by [Prajwal Murthy](https://github.com/prajwal-svm) and contributors. Templates, code, documentation, and feedback from your own writing all help shape the project. Read the [contributing guide](CONTRIBUTING.md) to take part.

If Oleafly makes your writing easier, [star the project on GitHub](https://github.com/Oleafly/Oleafly) so the next researcher can find it too.

## Cite Oleafly

If Oleafly helped you write a paper, one BibTeX entry in your bibliography helps the next researcher identify the tool:

```bibtex
@software{oleafly,
  author  = {Venkateshmurthy, Prajwal S and {The Oleafly contributors}},
  title   = {Oleafly: a local-first desktop workspace for research writing},
  year    = {2026},
  version = {0.4.1},
  url     = {https://github.com/Oleafly/Oleafly},
  license = {AGPL-3.0-or-later}
}
```

GitHub's **Cite this repository** button offers the same reference in APA and BibTeX, generated from [CITATION.cff](CITATION.cff). The app also has a copy button for it under Settings, Help & About.

[Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](LICENSE)

## Star history

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>
