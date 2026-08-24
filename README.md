<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](docs/readme-translations/README.de.md) | [English](../../README.md) | [Español](docs/readme-translations/README.es.md) | [Français](docs/readme-translations/README.fr.md) | [日本語](docs/readme-translations/README.ja.md) | [한국어](docs/readme-translations/README.ko.md) | [Português](docs/readme-translations/README.pt.md) | [Русский](docs/readme-translations/README.ru.md) | [中文](docs/readme-translations/README.zh.md) | العربية

<h2>A complete research harness, re-engineered for the AI era.</h2>

Write, compile, proofread, search literature, manage citations, build figures,
review PDFs, and trace changes in Git. Use hosted AI, a custom endpoint, local
Ollama, or no AI at all. Oleafly keeps your projects in plain folders on your
computer.

[![Open issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**[Download Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) ·
[Read the product docs](https://oleafly.com/docs/overview/) ·
[Build from source](docs/development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-editor-v0.3.10-r2.png" alt="Oleafly editing the LLaMA research paper in LaTeX with the source tree, document outline, and compiled PDF open together" width="100%" />
</div>

<!--
Recording placeholder: the hero image stands in until a 45–60 second workspace
walkthrough is ready. Keep the same framing and replace the hero above with
https://cdn.oleafly.com/videos/workspace-tour.webp.
-->

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
| Submit | Compile, publication, accessibility, reference, privacy, and ATS checks, plus reader-view extraction and several export formats |
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

Preflight checks the whole project, the latest compiler log, and the compiled
PDF. Its six independent checks cover compile and layout problems, publication
profiles for conferences and journals, ATS parsing, accessibility, references
and assets, and privacy for blind review. Findings say whether they are verified
from the document or advisory and in need of author review.

The reader view opens the PDF's extracted text page by page, close to what a
screen reader or automated parser receives. Preflight is practical submission
guidance, not a guarantee of acceptance or a formal accessibility certificate.

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

## Coming Soon

The roadmap keeps Oleafly open, local-first, and useful across the full
research workflow.

- **App localization.** Navigate Oleafly in more languages so researchers can
  work in the interface that feels most natural to them.
- **Agent skills and plugins.** Add focused, reusable AI workflows that send
  less repeated context and use fewer tokens.
- **Autonomous research agents.** Turn a research question and source set into
  a structured first draft that gives your work a head start.
- **Real-time collaboration and comments.** Work together with unlimited,
  self-hosted collaboration for research teams.
- **Oleafly CLI.** Use a lightweight, installable command-line package for
  research workflows that do not need a GUI.
- **Deeper Typst and Markdown support.** Bring more of Oleafly's editing,
  preview, and publishing workflow to both formats.
- **More research integrations.** Connect Mendeley and additional reference,
  library, and research services.
- **Self-hosted cloud sync.** Keep projects in sync across devices, with better
  automatic GitHub sync when you want it.

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
host_target="$(rustc -vV | sed -n 's/^host: //p')"
./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"
pnpm tauri dev
```

See the [development guide](docs/development.md) for prerequisites, platform
setup, production builds, and the source-only command-line workflow.

These scripts download the checksum-pinned compiler sidecars for your current
platform into `src-tauri/binaries`. The `all` argument is for CI and release
packaging, where every supported platform must be prepared.

Editor intelligence through TexLab and Tinymist is optional for a local run.
Fetch those language servers with `pnpm language-servers:fetch`. See the
[language-server toolchain](docs/language-server-toolchain.md) for its integrity,
licensing, and distribution policy.

### Command line

`oleaflyc` manages Oleafly projects without launching the desktop app. It
builds from source in this repository and is not published as a standalone
package yet.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

Commands run against the current directory. Pass `-C <path>` to point at
another project. Run `oleaflyc --help` for the full command list.

## Developer Docs

User guides live in the [Oleafly product docs](https://oleafly.com/docs/overview/).
The references below are for contributors, integrators, and release maintainers.

| Reference | Covers |
| --- | --- |
| [Engineering index](docs/README.md) | Feature inventories and engineering contracts |
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

<table>
  <tr>
    <td width="38%" valign="top">
      <img src="docs/assets/oleafly-club.png" alt="The Oleafly Club: an open-source research community celebrating drafts, revisions, tests, and successful submissions" width="100%" />
    </td>
    <td width="62%" valign="top">
      <h3>Researchers deserve tools they can inspect, extend, and trust.</h3>
      <p>Oleafly is built in the open by <a href="https://github.com/prajwal-svm">Prajwal Murthy</a> and contributors. Bug reports, fixes, templates, documentation, and careful product feedback are welcome.</p>
    </td>
  </tr>
</table>

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

## Community & Support

- Ask questions, share ideas, and request workflows in
  [GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
- Report bugs and request features in
  [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).
- 🔔 Follow [@OleaflyHQ on X](https://x.com/OleaflyHQ) for product and release
  updates.

⭐ If Oleafly helps your work, please
[star the repository](https://github.com/Oleafly/Oleafly). That small click
helps more researchers find the project and supports continued development.

## Star History

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=ZRIr-1jiqjn35WhaqiDqKsmeII-LmnrILQdxzg5v_RX8-PFtlYa4d5IY7U2-Mcn1_D2-0k4e440BGXMhRskNzn-mZUGI59rpIErWId2F600cSJDgZqwcQ3BxV6zC3m5peZz6s_P_Mla0ZW06zikSg5LHLCIALEzrFnLqag7R_rQ7haTYEGHvSdgx76__" />
 </picture>
</a>

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
