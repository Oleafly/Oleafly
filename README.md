<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](README.de.md) | **English** | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Português](README.pt.md) | [Русский](README.ru.md) | [中文](README.zh.md)

**Write, compile, and publish research with an AI workspace you own.**

Write in LaTeX, Typst, or Markdown. Compile beside your source. Keep every
revision in Git. Use AI on your terms.

Oleafly is a free, 100% open-source desktop app for macOS, Windows, and Linux.
It is local-first, works without an account, and keeps plain project files on
your computer.

[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)
[![GitGem](https://gitgem.org/api/badge/github/Oleafly/Oleafly.svg)](https://gitgem.org/github/Oleafly/Oleafly)

**[Download Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Read the engineering docs](docs/README.md) ·
[Build from source](docs/development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-light.png" alt="Oleafly with a LaTeX editor and compiled PDF open side by side (light theme)" width="92%" />
  <br /><br />
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor.png" alt="Oleafly with a LaTeX editor and compiled PDF open side by side (dark theme)" width="92%" />
</div>

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf.png" alt="The Oleafly library showing projects as coloured books with engine, kind, and last-modified labels (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/library-shelf-light.png" alt="The Oleafly library showing projects as coloured books with engine, kind, and last-modified labels (light theme)" /></td>
  </tr>
</table>

</div>

<!--
Recording placeholder: the stacked hero stands in until a 45–60 second
workspace walkthrough is ready. Keep the same framing and replace the sources
above with https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

> [!NOTE]
> Oleafly is ready for day-to-day documents, but the project is still moving
> quickly. Advanced package compatibility and a few platform integrations are
> still being hardened. macOS releases are signed and notarized. Windows
> releases use Authenticode when release signing is configured. Download only
> from the official releases page, and check the release notes if your operating
> system shows a warning.

## Research has enough moving parts already

A technical document usually ends up spread across an editor, a compiler, a
PDF viewer, a bibliography tool, Git, and an AI chat that cannot see the actual
project. Oleafly brings that work into one desktop app while leaving the source
readable in other editors and command-line tools.

The same project view works for a course report, a journal paper, or a
hundred-page thesis:

| Your work | What Oleafly handles |
| --- | --- |
| Write | Source and visual editing, autocomplete, symbols, citations, figures, tables, and whole-project code intelligence |
| Compile | Bundled LaTeX and Typst engines, Markdown through Pandoc, parsed errors, logs, and offline cached builds |
| Inspect | A fast PDF preview, page and zoom controls, two-page layouts, color inversion, and bidirectional SyncTeX |
| Revise | Autosave, real Git history, diffs, restore, and GitHub sync |
| Submit | ATS and accessibility preflight, reference checks, reader-view extraction, and several export formats |
| Get help | An optional project-aware AI assistant, local Ollama models, hosted providers, and MCP clients |

If you like Overleaf's write-and-preview loop but want compilation, files, Git,
and model choice on your own machine, Oleafly is made for that workflow. It can
also replace much of the setup around a local editor, TeX toolchain, PDF viewer,
and Git client.

Oleafly does not offer live multi-user browser editing today. Git and GitHub
are the current collaboration path.

## What you can do

### Write with the source in reach

- Work with LaTeX, Typst, and Markdown projects, including large multi-file
  documents, images, includes, and bibliographies.
- Switch LaTeX and Markdown between Code and Visual views. Unsupported rich
  blocks stay visible as editable source instead of disappearing.
- Insert headings, lists, links, citations, cross-references, equations,
  fractions, figures, tables, and symbols from the editor toolbar.
- Use command, citation, label, file, slash-command, and inline ghost-text
  completion.
- Find and replace, fold sections and environments, turn on Vim bindings, and
  run offline spelling and grammar checks.
- Jump to definitions, find references, rename labels or citation keys across
  the project, and inspect definitions on hover.

The project map indexes every section, label, citation key, and environment in
the project and keeps them addressable by `file:line`, so navigation and
renames work across a multi-file document rather than one buffer at a time.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure.png" alt="Oleafly's source tree beside the project map, listing sections and labels with their file and line (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-structure-light.png" alt="Oleafly's source tree beside the project map, listing sections and labels with their file and line (light theme)" /></td>
  </tr>
</table>

</div>

The citation picker reads the project's `.bib` files directly, so keys come
with their author, year, title, and the line they were defined on.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker.png" alt="Choosing a citation key from parsed BibTeX entries, each showing authors, year, and source line (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/citation-picker-light.png" alt="Choosing a citation key from parsed BibTeX entries, each showing authors, year, and source line (light theme)" /></td>
  </tr>
</table>

</div>

A LaTeX-aware word count ignores markup and counts only what a reader sees.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count.png" alt="The word count popover reporting words, characters, and lines for the open document (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/word-count-light.png" alt="The word count popover reporting words, characters, and lines for the open document (light theme)" /></td>
  </tr>
</table>

</div>

### Compile and read without leaving the project

- Compile LaTeX with bundled Tectonic by default. Each project can instead use
  `latexmk` with pdfLaTeX, XeLaTeX, or LuaLaTeX when a traditional TeX
  toolchain is required.
- Use a detected MacTeX, TeX Live, MiKTeX, or TinyTeX installation. If none is
  available, Oleafly can install a managed TinyTeX copy without administrator
  access. Use system TeX only with projects you trust because it is not fully
  sandboxed.
- Compile Typst with its bundled engine. A full TeX installation is not needed
  for the default Tectonic workflow.
- See compiler failures as editor diagnostics and readable error cards rather
  than hunting through a raw log.
- Read the PDF beside the source with continuous scrolling, virtualized pages,
  single or two-page layouts, fit controls, page navigation, fullscreen, and
  an optional detached preview window.
- Use SyncTeX in both directions: jump from source to PDF, or
  Cmd/Ctrl-click PDF text to return to the matching source.
- Save the PDF into the project or export the source as a portable archive.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine.png" alt="The LaTeX Engine settings page showing the bundled engines and their options (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-latex-engine-light.png" alt="The LaTeX Engine settings page showing the bundled engines and their options (light theme)" /></td>
  </tr>
</table>

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-figures.png" alt="A compiled page showing plots, a colour-mapped error surface, and a results table beside the LaTeX source" width="88%" />
</div>

Zoom out and the whole document is on screen at once, which is usually the
fastest way to check that floats, figures, and tables landed where you meant.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread.png" alt="A three-page document laid out in the preview with every figure and table visible (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/pdf-preview-spread-light.png" alt="A three-page document laid out in the preview with every figure and table visible (light theme)" /></td>
  </tr>
</table>

</div>

### Keep a history you can inspect

Every project is a real Git repository. Oleafly commits after successful
compiles and after quiet editing periods, then exposes the useful parts of that
history in the app.

- Review a commit timeline and side-by-side diffs.
- Restore an earlier file without replacing the rest of the project.
- Stage, discard, commit, push, and pull from the Source Control panel.
- Publish a project to GitHub or connect an existing repository.
- Keep working from the terminal or another editor. There is no private
  document format to unpack.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/git-diff.png" alt="A side-by-side source diff in Oleafly's Git history" width="84%" />
</div>

### Start from something useful

The project gallery includes editable starters for papers, theses, reports,
books, presentations, posters, assignments, letters, bibliographies, resumes,
and diagrams. Filter by document engine, offline readiness, or ATS suitability.
Optional template packs and fonts download only when you choose them.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates.png" alt="Oleafly's searchable project template gallery with live thumbnails, category counts, and engine filters (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/project-templates-light.png" alt="Oleafly's searchable project template gallery with live thumbnails, category counts, and engine filters (light theme)" /></td>
  </tr>
</table>

</div>

### Move between research and publishing tasks

- Add a citation from a DOI, arXiv ID, URL, or title search. Oleafly writes a
  deduplicated BibTeX entry and inserts the citation at the cursor.
- Draw a diagram on a visual canvas or edit its TikZ directly, then insert it
  as vector source or an image. The saved TikZ can be reopened and edited.
- Import Word documents through Pandoc, reconstruct an editable LaTeX project
  from a PDF locally, import an Overleaf project ZIP, or transcribe an equation
  image with a vision model.
- Export PDF and source archives, plus Word, HTML, Markdown, text, PowerPoint,
  or EPUB when the document engine and project type support them.
- Browse conference deadlines and use optional literature lookups without
  turning the project folder into a cloud document.

Citation search queries arXiv, Semantic Scholar, Crossref, PubMed, OpenAlex,
and Google Scholar together, combines duplicate records, and saves or exports
what you keep as BibTeX. It can also scan the open document paragraph by
paragraph and suggest citations for claims that do not have one yet.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search.png" alt="Citation search returning deduplicated results from several indexes, each with a save and copy-BibTeX action (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/literature-search-light.png" alt="Citation search returning deduplicated results from several indexes, each with a save and copy-BibTeX action (light theme)" /></td>
  </tr>
</table>

</div>

The diagram composer draws on a canvas and compiles the TikZ beside it, so the
figure you insert is real vector source you can keep editing.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer.png" alt="The diagram composer with a transformer architecture on the canvas and its compiled TikZ preview alongside (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/diagram-composer-light.png" alt="The diagram composer with a transformer architecture on the canvas and its compiled TikZ preview alongside (light theme)" /></td>
  </tr>
</table>

</div>

### Check the document before someone else does

Preflight looks at both source and compiled output. It catches broken
references, missing assets, duplicate labels, reading-order problems, missing
metadata, inaccessible figure patterns, and resume layouts that are difficult
for applicant tracking systems to parse.

It also shows the text a parser or screen reader can extract. These checks are
practical submission guidance, not a formal accessibility certification.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats.png" alt="Preflight reporting an accessibility score with specific source and compiled-output findings (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/preflight-ats-light.png" alt="Preflight reporting an accessibility score with specific source and compiled-output findings (light theme)" /></td>
  </tr>
</table>

</div>

References and citations get their own panel: the bibliography, every citation
used in the document, and the symbols the project defines.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel.png" alt="The references panel listing bibliography entries by key and year beside the source and compiled PDF (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/references-panel-light.png" alt="The references panel listing bibliography entries by key and year beside the source and compiled PDF (light theme)" /></td>
  </tr>
</table>

</div>

### Let AI work on the project, if you want it

The assistant can read and edit files, search the project, compile, inspect the
log, and extract PDF text to check its own result. It can also help with
citations, imported documents, and editable TikZ figures.

You choose the model:

- Connect a supported hosted provider with your own API key.
- Run a local model through Ollama.
- Leave AI unconfigured and use the rest of the app normally.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start.png" alt="The assistant panel offering starting points such as finding papers to cite, writing a literature review, and fixing source errors (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-assistant-start-light.png" alt="The assistant panel offering starting points such as finding papers to cite, writing a literature review, and fixing source errors (light theme)" /></td>
  </tr>
</table>

</div>

File changes come with a diff and Approve or Reject controls. "Always allow"
can approve ordinary writes for the current session while deletes still stop
for confirmation.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-approval-diff.png" alt="An assistant file change shown as a red and green diff with Reject, Always allow, and Approve controls" width="88%" />
</div>

Once approved, the edit lands in the file and the document recompiles. Every
response keeps a "Restore code to before this response" action.

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/ai-chat-applied.png" alt="An approved assistant edit applied to the document and reflected in the recompiled PDF" width="88%" />
</div>

Providers are configured in Settings. Keys are encrypted on disk and resolved
by the Rust backend, so the webview never receives them. Hosted requests send
the key only to the selected provider. A local Ollama model needs no cloud key.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai.png" alt="The AI Assistant settings page with several providers connected and a local Ollama model selected (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-ai-light.png" alt="The AI Assistant settings page with several providers connected and a local Ollama model selected (light theme)" /></td>
  </tr>
</table>

</div>

Oleafly can also expose its project tools to Claude Desktop, Claude Code,
Cursor, Codex, and other MCP clients. The server binds to localhost and supports
read-only mode plus three approval policies. Native file tools can keep working
after the last window closes when the selected policy permits it. They stay
confined to the last project reported by the app and never choose another
library project by recency.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp.png" alt="MCP settings showing the local server, its client instructions, and the available approval policies (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/settings-mcp-light.png" alt="MCP settings showing the local server, its client instructions, and the available approval policies (light theme)" /></td>
  </tr>
</table>

</div>

See the [feature reference](docs/features.md) and [MCP setup](docs/mcp.md) for
the current providers, tools, and security model.

Everything is reachable from one place: the omnibar searches projects and
documents, and typing `/` turns it into a command palette.

<div align="center">

<table>
  <tr>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar.png" alt="The omnibar listing commands and recently updated projects (dark theme)" /></td>
    <td width="50%"><img src="https://cdn.oleafly.com/images/screenshots/desktop/search-omnibar-light.png" alt="The omnibar listing commands and recently updated projects (light theme)" /></td>
  </tr>
</table>

</div>

## Local-first, with a clear network boundary

No account and no telemetry are required. Core project data stays on your
machine.

| Runs or stays local | Uses the network only when you ask |
| --- | --- |
| Project files and editor buffers | A hosted AI provider you connect |
| Git repositories and history | GitHub publish, push, and pull |
| Compilation with cached packages | TeX packages needed for the first compile |
| PDF rendering and text extraction | Optional templates, fonts, Pandoc, or TinyTeX downloads |
| Spellcheck, grammar, and preflight | Citation, literature, conference-deadline, and update lookups |
| Local AI through Ollama |  |

API keys are stored locally. Plain document files remain usable even if you
stop using Oleafly.

## Install

Download the latest build from
[GitHub Releases](https://github.com/Oleafly/Oleafly/releases/latest).

| Platform | Installer |
| --- | --- |
| macOS, Apple Silicon | `.dmg` |
| Windows, x86_64 | `.msi` or `-setup.exe` |
| Linux, x86_64 | `.AppImage` or `.deb` |
| Linux, ARM64 | `.AppImage` or `.deb` |

Linux packages require glibc 2.39 or newer.

The first LaTeX compile may download packages required by the document.
Tectonic caches them for later builds, and Offline mode restricts compilation
to that cache.

To run from source:

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
pnpm install
./scripts/fetch-tectonic.sh all
./scripts/fetch-biber.sh all
./scripts/fetch-typst.sh all
pnpm language-servers:fetch
pnpm tauri dev
```

See the [development guide](docs/development.md) for prerequisites, platform
setup, production builds, and the source-only command-line workflow.

### Command line

`oleaflyc` manages Oleafly projects without launching the desktop app. It is
currently available from this repository and is not published as a standalone
package.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

Commands use the current directory by default. Pass `-C <path>` to manage a
different project directory. Run `oleaflyc --help` for the complete interface.

## Documentation

The repository keeps public engineering and product references close to the
code. End-user task guides are maintained separately from this public index.

| Reference | Covers |
| --- | --- |
| [Product-engineering catalog](docs/README.md) | Feature inventories and engineering contracts |
| [Feature reference](docs/features.md) | The product surface and supported workflows |
| [Document engines](docs/document-engines.md) | LaTeX, Typst, and Markdown capabilities |
| [Product architecture](docs/architecture.md) | System boundaries, package ownership, and extension points |
| [Development](docs/development.md) | Local setup, tests, and contribution workflow |
| [Language-server toolchain](docs/language-server-toolchain.md) | Fetching, integrity, and distribution policy |
| [MCP integration](docs/mcp.md) | External clients, access tokens, and approval policies |
| [Releasing](docs/releasing.md) | Release workflow and artifact checks |
| [Code signing](docs/signing.md) | Platform signing requirements |
| [Auto-updates](docs/updates.md) | Update manifests, signatures, and rollback |

## Contributing

<div align="center">
  <img src="docs/assets/oleafly-club.png" alt="The Oleafly Club: an open-source research community celebrating drafts, revisions, tests, and successful submissions" width="92%" />
</div>

Oleafly is built in the open by
[Prajwal S Venkateshmurthy](https://github.com/prajwalsvenkatesh) and
contributors. Bug reports, fixes, templates, documentation, and careful
product feedback are welcome.

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Open an issue before a large change. Small, focused fixes can go straight
   to a pull request.
3. Run the relevant checks before submitting:

   ```bash
   pnpm build
   pnpm test
   cargo test --workspace --all-targets
   ```

Please report security issues privately as described in
[SECURITY.md](SECURITY.md). Participation is covered by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Credits

Oleafly builds on
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/), and
[Hunspell](https://hunspell.github.io/).

Oleafly is licensed under
[AGPL-3.0-or-later](LICENSE). Third-party notices are listed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
