<div align="center">

<img src="media/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly" width="120" height="120" />

# Oleafly

### A local-first workspace for research papers, technical documents, and resumes.

**Oleafly is a free, open-source, AI-native document studio for macOS, Windows,
and Linux. Your projects stay on your machine, no account is required, and the
default LaTeX and Typst engines ship with the app.** Every successful compile
becomes a Git commit. AI is optional: bring your own provider, run a local
model, or leave it disabled.

*Documents should outlive services.*

[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fmain%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

</div>

<br/>

<div align="center">
<img src="media/hero-editor.png" alt="Type on the left, watch the PDF build on the right" width="90%" />
</div>

<br/>

<div align="center">

**[Download the app](https://github.com/Oleafly/Oleafly/releases/latest) · [Build from source](docs/install.md) · [Docs](https://oleafly.com/docs/)**

Grab a prebuilt installer for macOS, Windows, or Linux from the [latest release](https://github.com/Oleafly/Oleafly/releases/latest), or [build it from source](docs/install.md).

If Oleafly is useful to you, a star helps other people find it.

</div>

> [!NOTE]
> **Status:** Oleafly is already usable for real projects. Some advanced workflows and package compatibility are still evolving. [Feedback and bug reports](https://github.com/Oleafly/Oleafly/issues) are welcome.

<br/>

<table align="center">
<tr>
<td width="50%"><img src="media/synctex.gif" alt="Cmd/Ctrl-click the PDF, jump to the source" width="100%" /><p align="center"><b>⌘/Ctrl-click the PDF, jump to the source</b></p></td>
<td width="50%"><img src="media/hero-editor.gif" alt="Generate a resume from a template" width="100%" /><p align="center"><b>Resumes work out of the box</b></p></td>
</tr>
<tr>
<td colspan="2" align="center"><img src="media/ai-fix.gif" alt="AI fixes a LaTeX error" width="100%" /><p align="center"><b>Let the AI fix a LaTeX error</b></p></td>
</tr>
</table>

<br/>

## Who it's for

- **Students.** Write assignments, reports, and a thesis without installing a full TeX distribution. The compiler ships inside the app.
- **Researchers.** Manage large multi-file papers with citations, cross-references, Git commit history, and an AI that reads the whole project.
- **Job seekers.** Build ATS-friendly LaTeX resumes, tailor them to job descriptions, and keep every version of every variant.
- **Developers.** Documents as plain files in real Git repos, synced to GitHub, open in any editor. LaTeX treated like code.

<br/>

## Install

**Download the app** from the [latest release](https://github.com/Oleafly/Oleafly/releases/latest):

| Platform | Grab |
|---|---|
| macOS (Apple Silicon) | `.dmg` |
| Windows | `.msi` or `-setup.exe` |
| Linux | `.AppImage`, `.deb`, or `.rpm` |

Current builds are not code-signed, so your operating system may warn on first
launch. Download only from the official releases page and follow the
[platform-specific first-launch steps](docs/install.md#first-launch).

**Or build from source:**

```bash
git clone https://github.com/Oleafly/Oleafly.git && cd Oleafly
./scripts/fetch-tectonic.sh all   # LaTeX compiler sidecar
./scripts/fetch-typst.sh all      # Typst compiler sidecar
pnpm install
pnpm tauri dev
```

Prerequisites and production builds are in the [install guide](docs/install.md).

<br/>

## Why Oleafly

Oleafly isn't trying to recreate Overleaf on the desktop. It's built around a different idea: technical documents deserve the same AI, Git, and local-first workflows that developers expect from modern code editors. This is document engineering.

- It compiles on your machine. No document server, upload queue, or account.
- Your files live in a plain folder on your disk. Nothing leaves it unless you tell it to.
- Every project is a Git repo; every successful compile becomes a commit.
- AI is optional. Plug in your own key, or run a local model with Ollama, or turn it off.
- The files are just `.tex`, `.bib`, and images. Open them in any other editor whenever you want.
- Editing and cached compilation work offline. First-use packages, optional
  assets, updates, sync, research lookups, and hosted AI providers require a
  network connection.

You get the polish of a cloud editor without handing your documents to one.

You can assemble most of these features yourself with VS Code extensions, Git, Copilot, TeX Live, PDF viewers, ATS tools, and scripts. Oleafly integrates them into one application that works out of the box.

**And while it's at it, Oleafly quietly replaces the rest of your stack: the paid resume builder, the ATS checker, the accessibility auditor, the Git client, and the AI copilot subscription.**

<br/>

## What makes it different

**Every compile becomes a Git commit.** Undo a paragraph from yesterday. Compare two versions side by side. Branch your resume before every interview. Push it to GitHub with one click. No plugin, no setup, no `resume_final_v3_FINAL.tex`.

This is Oleafly's superpower. Every project is a real Git repo on your disk: the app commits your work automatically (after every successful compile, and shortly after you stop editing) and gives you history, diffs, and one-click restore right in the UI. And because it's real Git, `git log` and `git blame` work from a terminal too.

<div align="center">
<img src="media/git-diff.png" alt="Side-by-side diff of a past version" width="85%" />
</div>

**Local, bring-your-own AI.** OpenAI, Anthropic, Groq, OpenRouter, DeepSeek, Mistral, xAI, Z.AI, or a local model through Ollama. Your prompts and documents don't touch a third party unless you pick one that does.

**MCP server.** Connect Claude Desktop, Claude Code, Cursor, or any MCP client and let it edit and compile your project with per-change approval. See [docs/mcp.md](docs/mcp.md).

**Everything on disk.** No blob store, no lock-in. A project is just `~/.oleafly/projects/<id>/`, a normal folder with a real `.git` inside.

<br/>

## Philosophy

> **Documents should outlive services.**
>
> Your thesis shouldn't disappear because a company shuts down.
>
> Your resume shouldn't require a subscription.
>
> Your research shouldn't depend on an internet connection.
>
> Your files belong to you.

<br/>

## Workflows

Oleafly does not hide document behavior behind separate product modes. The
same local project, compilation, Git, preflight, and AI foundations support
different workflows:

- [Resume workflows](docs/resume-workflows.md): build ATS-aware resumes, inspect
  what parsers can read, tailor variants, and keep each version in Git.
- [Research workflows](docs/research-workflows.md): manage papers, theses,
  bibliographies, figures, cross-references, and multi-file projects.

<br/>

## Features

Core editing, compilation, preview, history, and analysis run on your machine.
Network-backed capabilities are opt-in. For deeper guides, see the
[documentation site](https://oleafly.com/docs/) or the
[repository documentation](docs/).

**Editor (CodeMirror 6)**
- LaTeX autocomplete for commands, `\ref`/`\label`, `\cite` (parsed from your `.bib`), and file names from the tree
- Slash commands: type `/` for a Notion-style insert menu (`/figure`, `/table`, `/section`, `/cite`, `/math`)
- Find and replace (`⌘F`) with case, whole-word, and regex toggles, a live match count, and preserve-case replace; go to line with `⌘⇧L`
- Code folding for `\begin…\end` environments and section trees
- Vim mode, toggleable in Settings
- Selectable syntax themes independent of the app's light/dark mode
- Offline spellcheck (Hunspell WASM) and grammar (Harper), masking commands, math, and comments so only prose is checked
- Compile errors surface as inline red squiggles, gutter marks, and collapsible per-error cards in the Logs panel

**Visual editor (WYSIWYG)**
- A Code/Visual toggle for LaTeX and Markdown projects: edit rendered headings, lists, bold/italic, blockquotes, and links directly, backed by a lossless round-trip parser and serializer
- Undo/redo is unified between Code and Visual, so switching modes never breaks history
- LaTeX constructs the rich editor doesn't yet render fall back to an editable, clearly-marked raw block instead of silently dropping content

**Code intelligence (whole-project, not just the open file)**
- Go to definition (F12 or Cmd/Ctrl-click) for `\ref`, `\cite`, `\gls`, custom macros, and environments, across files
- Find references (Shift-F12) lists every use in a side panel
- Rename symbol (F2) updates a label, citation key, or macro everywhere at once, and warns on clashes
- Hover a `\ref`, `\cite`, or macro to see where it's defined
- The AI can read a project map (outline, labels, citations, macros, file graph)

**Compile and PDF**
- Tectonic (XeTeX) runs as a bundled sidecar, producing ATS-clean output with embedded subset fonts
- Debounced auto-compile (~2.5s) plus manual recompile with `⌘↵`
- Offline mode compiles with `--only-cached` and never touches the network
- pdf.js viewer with continuous scroll, single-page or two-page (spread) layouts, zoom (buttons or trackpad pinch), fit-to-width/height, page navigation (current/total, prev/next, jump-to), presentation mode, and an invert-colors toggle
- Bidirectional SyncTeX: Cmd/Ctrl-click a word in the PDF to land on that exact word in the source, or jump source-to-PDF with `⌘⇧J`
- The viewer is virtualized, so it stays smooth on documents hundreds of pages long (a thesis or a book)

**Preflight: ATS and accessibility checks**
- Two scores out of 100: ATS readiness and accessibility
- Source checks for multi-column layouts, missing image alt text, icon-hidden contact info, layout tables, skipped heading levels, undescriptive links, missing document language or PDF title, and more
- Output checks (after compiling) for reading order, garbled or unmapped text, and pages with no selectable text
- Plain-text preview of what a parser or screen reader actually sees, plus a simulated ATS extraction for resumes
- Reference and asset checks for undefined citations, duplicate labels, duplicate bib entries, and missing includes
- Prepare-for-accessible-export rewrites your document with the tagging setup a LuaLaTeX engine needs, showing every change first
- Optional LuaLaTeX engine: use an existing TeX Live installation or install
  TinyTeX on demand to compile and verify a tagged, Section 508 / PDF-UA
  oriented PDF

**Projects, files, and history**
- Library home with thumbnails, engine labels, last-edited time, project details, export history, metadata search, and advanced filters
- Progressive, persisted tours for Home, the project workspace, Settings, AI Assistant, and Diagram Composer
- Searchable keyboard reference plus safe, customizable application shortcuts in Settings
- Template gallery on new-project: browse by category, document engine, offline
  readiness, or ATS suitability, with search and live previews. Bundled and
  downloadable templates cover resumes, papers, theses, books, presentations,
  posters, assignments, newsletters, calendars, bibliographies, and letters.
- On-demand fonts: templates that use premium open-source fonts (Lato, PT Sans, PT Serif) download them only when needed and copy them into the project, so the app stays small and documents stay self-contained. Manage downloads in Settings, Offline & Downloads.

<div align="center">
<img src="media/project-templates.png" alt="The template gallery with categories, search, and live previews" width="85%" />
</div>

- Source tree: create files and folders (nested to any depth), rename, delete, duplicate (files and whole folders), and reorganize by drag and drop; right-click a folder to add a file or folder inside it; upload files and set the main document
- Multi-file support for `\input`, images (PNG/JPG/PDF/EPS), and `.bib`, with editor tabs
- Autosave to disk shortly after you stop typing
- Every project is a Git repo with automatic commits (after successful compiles, and shortly after you stop editing), a full history view, side-by-side diffs, and one-click restore

**Source control and sync**
- Stage or discard changes, write a message, and Commit, Push, or Pull
- Publish to GitHub (new or existing repo) with ahead/behind indicators

<div align="center">
<img src="media/github-push.gif" alt="Publish a project to GitHub in one click" width="85%" />
</div>


**Citations**
- Paste a DOI, arXiv id, or URL to fetch an entry, or search Crossref by title
- Oleafly appends a correctly-keyed BibTeX entry (deduplicated by DOI) and inserts the `\cite` at your cursor
- Lookups send only the identifier or title, and respect offline mode

**AI assistant (bring your own model)**
- Reads and writes files, find-and-replace, create, rename, delete
- Compiles, reads the log, and extracts PDF text to verify its own edits
- Searches across projects, sets the main doc, toggles the theme
- Research connectors: search OpenAlex literature, verify citations, and pull
  paper metadata from alphaXiv, each with its own encrypted API key
- Every file-changing edit pauses for approval with a red/green diff, and the decision stays in the chat
- Custom instructions, sandboxed so they can't reveal or override the built-in prompt
- Supports hosted providers and local models through Ollama; see the
  [AI Assistant guide](docs/ai-assistant.md) for the current provider list

**Templates, deadlines, and growth**
- Template packs downloaded on demand from the open
  [Oleafly template catalog](https://github.com/Oleafly/template-packs):
  journal and conference classes
  (REVTeX, ACS, Elsevier, ACM), resume and CV expansions, slides and
  posters. The catalog grows without app updates.
- Generate a template with AI: describe the document, preview the compiled
  result, and save it as a permanent gallery entry
- Conference deadlines browser with live countdowns, field filters, and
  search, fed by the open ccf-deadlines dataset

**Import and export**
- Import: Word (`.docx`) via Pandoc, PDF to LaTeX through a built-in local
  converter (runs entirely on your machine, no AI required) with optional AI
  refinement, and photo-of-equation to LaTeX with a vision model
- PDF export with selectable text and embedded fonts, plus source-as-`.zip`
- First-class Markdown projects compile to PDF through Pandoc and the bundled
  Tectonic engine. Word (.docx), HTML, and Markdown export use the same Pandoc
  installation, downloaded on demand or installed separately
- Light and dark themes with Geist tokens, following your system setting
- Command palette (`⌘K`) to fuzzy-search every action
- In-app version display and update checker
- Offline mode for cached compilation, no Oleafly account, and no telemetry

<br/>

## Documentation

The product guides live at **[oleafly.com/docs](https://oleafly.com/docs/)**.
Contributor and implementation documentation is maintained in this repository.

| Guide | What's inside |
|---|---|
| [Download](https://github.com/Oleafly/Oleafly/releases/latest) | Prebuilt installers (.dmg / .msi / .exe / .AppImage / .deb / .rpm) |
| [Overview](https://oleafly.com/docs/overview/) | What Oleafly is and a tour of the whole app |
| [Getting started](https://oleafly.com/docs/getting-started/) | First project to first PDF in a couple of minutes |
| [Templates](https://oleafly.com/docs/templates/) | The full gallery: resumes, papers, theses, posters, decks |
| [Resume workflows](docs/resume-workflows.md) | Templates, ATS preflight, variants, and tailoring |
| [Research workflows](docs/research-workflows.md) | Papers, theses, citations, figures, and multi-file projects |
| [Preflight: ATS & accessibility](https://oleafly.com/docs/preflight/) | Section 508 / PDF-UA and resume-parser checks, before you submit |
| [AI assistant](https://oleafly.com/docs/ai-setup/) | Connect a model, or go local with Ollama |
| [MCP server](docs/mcp.md) | Drive Oleafly from Claude Desktop, Claude Code, Cursor, and other MCP clients |
| [GitHub sync](https://oleafly.com/docs/github-sync/) | Back up and sync across machines |
| [Keyboard shortcuts](https://oleafly.com/docs/keyboard-shortcuts/) | The ones worth memorizing |
| [FAQ](https://oleafly.com/docs/faq/) | Common questions and fixes |
| [Build from source](docs/install.md) | For developers: clone, install deps, run |
| [Development](docs/development.md) | Setup and how to contribute |
| [Architecture](docs/architecture.md) | System boundaries, backend services, frontend packages, and extension points |
| [Auto-updates](docs/updates.md) | How releases sign & ship in-app updates (maintainers) |

<br/>

## Contributing

Bug reports, features, templates, docs, and screenshots are all welcome. Have an idea? [Open a discussion](https://github.com/Oleafly/Oleafly/discussions).

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get a dev build running.
2. Open an issue for big changes. Small fixes can go straight to a PR.
3. Run `pnpm build` and `cargo test --lib` (in `src-tauri/`) before submitting.

Found a security issue? Report it privately, see [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

<br/>

## Credits

Built on [Tectonic](https://tectonic-typesetting.github.io/), [Tauri](https://tauri.app/), [CodeMirror](https://codemirror.net/), [pdf.js](https://mozilla.github.io/pdf.js/), [React](https://react.dev/), [Zustand](https://github.com/pmndrs/zustand), [Tailwind CSS](https://tailwindcss.com/), [Geist](https://vercel.com/geist/introduction), [Harper](https://writewithharper.com/), and [Hunspell](https://hunspell.github.io/).

**License:** [AGPL-3.0-or-later](LICENSE) © 2026 Prajwal S Venkateshmurthy and contributors. Oleafly is free and open source: use, study, modify, and share it freely. The AGPL's network copyleft means anyone who runs a modified version (including as a hosted service) must make their source available under the same license. Bundled open-source components are listed in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.md).
