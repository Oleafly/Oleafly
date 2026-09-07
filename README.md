<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-tile-gradient-256.png" alt="Oleafly logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](docs/readme-translations/README.de.md) | **English** | [Español](docs/readme-translations/README.es.md) | [Français](docs/readme-translations/README.fr.md) | [日本語](docs/readme-translations/README.ja.md) | [한국어](docs/readme-translations/README.ko.md) | [Português](docs/readme-translations/README.pt.md) | [Русский](docs/readme-translations/README.ru.md) | [中文](docs/readme-translations/README.zh.md) | [العربية](docs/readme-translations/README.ar.md)

[![Open issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues)
[![Download](https://img.shields.io/github/v/release/Oleafly/Oleafly?label=Download&color=22c55e)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases)
[![CI](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE)
<br/>
[![macOS · Windows · Linux](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-blue)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**Write your next paper with less busywork.**

Oleafly is a free desktop workspace for writing papers in LaTeX, Typst, and Markdown. Find sources, manage citations, and see your paper take shape in one place. Bring an AI assistant to revise a section, create a figure, or fix a broken build, with changes you can review. Your project stays in ordinary files you own, and you can use the editor with or without AI.

**[Download Oleafly — free. No account required.](https://github.com/Oleafly/Oleafly/releases/latest) · [Read the product docs](https://oleafly.com/docs/) · [Build from source](docs/development.md)**

</div>

<div align="center">
  <img src="https://cdn.oleafly.com/images/screenshots/desktop/hero-light-bg.png" alt="Oleafly editing the LLaMA research paper in LaTeX with the source tree, document outline, and compiled PDF open together" width="100%" />
</div>

## Features

Write a thesis, a conference paper, a lab report, or a resume for your next
application. Choose LaTeX, Typst, or Markdown and bring the whole document
into one workspace.

| Feature | What you can do |
| --- | --- |
| **LaTeX, Typst, and Markdown** | Write and compile with a PDF preview beside your source. |
| **Templates and imports** | Start a paper, thesis, report, presentation, or resume; bring an existing project across. |
| **Writing tools** | Complete commands, navigate chapters, rename references, and check spelling and grammar locally. |
| **Literature search** | Search scholarly indexes together and discover references for the paragraphs you are writing. |
| **Citations and libraries** | Import your reference library, add papers by DOI or title, and insert citations as you write. |
| **AI assistance** | Revise a section, fix a build, or create a figure using the files in your project. |
| **Research tasks · beta** | Run work on a separate copy, review the results, and choose which files to apply. |
| **Research skills** | Work through literature reviews, claim checks, data analysis, and responses to reviewers. |
| **Figures and diagrams** | Draw on a canvas, edit TikZ, and preview a compiled figure before inserting it. |
| **Submission checks** | Check references, layout, anonymous-review details, accessibility, and resume parsing. |
| **Checkpoints and Git** | Recover saved project states and manage commits, diffs, and GitHub sync. |
| **Linked folders** | Give the assistant read-only access to papers or data stored elsewhere on your computer. |
| **Export** | Save PDF and source ZIPs, with document, presentation, and ebook exports for supported project types. |

### Start with the document you need

Choose a journal article, a thesis, a Beamer talk, or a resume you can make your
own. The template gallery includes LaTeX, Typst, and Markdown starters, with
previews to help you pick a layout before you start writing.

Already have a manuscript? Import a project ZIP or GitHub repository, bring
in a Word document, or use a PDF as the starting point for editable LaTeX.
Your next project can begin with work you have already done.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/document-starters-dark-window-v1.png" alt="The Oleafly template gallery with document previews and project starters" width="100%" />

### Write with the whole document in view

Keep your source, chapter outline, and compiled PDF together. Move between
sections, follow a reference to its definition, and rename a citation key
across the project. In LaTeX, command suggestions follow the packages you use,
and spelling and grammar checks focus on your prose.

Write directly in source or use the visual editor for LaTeX and Markdown.
Equations, citations, and figures stay within reach as the document grows.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/manuscript-writing-dark-window-v1.png" alt="Oleafly showing a research paper with its LaTeX source and compiled PDF together" width="100%" />

### Find the sources your argument needs

Search arXiv, Semantic Scholar, Crossref, PubMed, and OpenAlex together.
Oleafly combines duplicate results and saves the papers you choose to your
bibliography. Search from a paragraph in your draft to find relevant work
you have not cited yet.

Bring your existing library from Zotero RDF, EndNote XML, RIS, or BibTeX.
Then add a reference by DOI or title and insert its citation without leaving
the sentence.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/literature-discovery-dark-window-v1.png" alt="Search results from scholarly indexes in Oleafly" width="100%" />

### Give your assistant the actual project

Ask it to tighten a section, explain an equation, or fix a build. The
assistant can read your files, edit the source, compile the document, and
inspect the result. Mention a file in your request to focus the work, or ask
for a plan before it starts.

Keep the model you prefer: connect a hosted provider, use Ollama locally, or
choose one of the CLI agents below. The editor is also fully usable with AI
off.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/assistant-at-work-dark-window-v1.png" alt="The AI assistant working alongside the open research project" width="100%" />

<details>
<summary>See a proposed edit before it is applied</summary>

In Ask for approval mode, read the proposed file diff and choose whether to
apply it. You can also approve ordinary writes for the session or select a
different approval policy in Settings.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/review-an-edit-dark-window-v1.png" alt="Approval controls for reviewing the assistant’s proposed changes" width="100%" />

</details>

### Turn an idea into a figure

Describe a diagram to the assistant or build it on the canvas. Edit the TikZ
source, compile the figure on its own, and see the render beside it. A model
with vision can inspect that render and help refine the layout.

Insert the result with a caption and label. Keep editable vector source in
the project, ready for the next revision or your coauthor's changes.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/figure-workshop-dark-window-v1.png" alt="The diagram workspace with editable source and a rendered figure" width="100%" />

### Keep writing while research moves forward

Give a research task a literature review, an analysis, or a section to
revise. It works on a separate copy of the project while you continue in the
manuscript. When the results are ready, review them file by file and apply
the changes you want to keep.

Research skills carry the work further: build a reading list, check claims
against source material, prepare a talk from the paper, or draft a response
to reviewers. Save a procedure of your own to use again in the next project.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/research-review-dark-window-v1.png" alt="The research workspace for tasks that run alongside the manuscript" width="100%" />

### Prepare the paper you want to submit

Check the manuscript and its compiled PDF before export. Preflight brings
unresolved references, layout problems, draft markup, and anonymous-review
details into one place, with findings you can follow back to the source.

For a resume, check how the PDF's text comes through to a parser. For a
paper, choose a publication profile and review its submission checks. Export
the PDF or package the source when you are ready to send it.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/submission-checks-dark-window-v1.png" alt="Preflight checks for a research paper before submission" width="100%" />

### Keep every project yours

Your work stays in ordinary files on your computer. Edit them in another
tool, share them with a coauthor, or put them in Git. There is no Oleafly
subscription to keep paying to open your own work.

Successful compiles save automatic checkpoints, so you can return to an
earlier project state. Use Git when you want commits and shared history.
You decide what to keep and when to publish it.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/project-history-dark-window-v1.png" alt="Saved project checkpoints in Oleafly" width="100%" />

## Supported CLI agents

Bring an agent you already use into the assistant and work through its own
account. Choose it in Settings, sign in, and put it to work on the open
project. Oleafly's built-in catalog includes these 14 agents:

| Agent | CLI command |
| --- | --- |
| Claude Code | `claude` |
| Codex CLI | `codex` |
| Gemini CLI | `gemini` |
| Cursor | `agent` |
| OpenCode | `opencode` |
| Pi | `pi` |
| Cline | `cline` |
| OpenClaw | `openclaw` |
| Hermes Agent | `hermes` |
| CodeBuddy | `codebuddy` |
| Kimi Code | `kimi` |
| Grok Build | `grok` |
| DeepSeek Harness | `dsh` |
| Qoder | `qodercli` |

CLI Agent support is in beta. Discover more compatible agents through the
registry in Settings. You can also connect an external assistant through
[MCP](docs/mcp.md).

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/cli-agents-dark-window-v1.png" alt="Claude Code and other CLI agents in the Oleafly assistant" width="100%" />

## A workspace that grows with your work

Oleafly's direction is a connected research workspace: the reading that
shapes a question, the analysis behind a result, the paper that explains it,
and the talk that shares it.

Next on the roadmap are live collaboration and comments, a multilingual
interface, deeper Typst and Markdown support, and optional sync across
devices. Follow the [changelog](CHANGELOG.md) as that work lands.

<img src="https://cdn.oleafly.com/images/screenshots/desktop/readme/project-library-dark-window-v1.png" alt="Research papers organized as projects in the Oleafly library" width="100%" />

## Download Oleafly

Free and open source. No account required.

| Platform | Download |
| --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/Oleafly/Oleafly/releases/latest) |
| Windows · x86_64 | [MSI or EXE](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · x86_64 or ARM64 | [AppImage or DEB](https://github.com/Oleafly/Oleafly/releases/latest) |

LaTeX uses bundled Tectonic, with cached packages available for offline
builds. Typst has a bundled compiler; Markdown uses Pandoc, available from
Settings. Linux packages require glibc 2.39 or newer.

This README follows development on the project. The [release notes](https://github.com/Oleafly/Oleafly/releases/latest)
list what is included in the latest installer.

[Product guides](https://oleafly.com/docs/) · [Developer documentation](docs/developer/README.md) · [Build from source](docs/development.md)

## Star History

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>

## Community & Support

Bring your questions, ideas, and research workflows to
[GitHub Discussions](https://github.com/Oleafly/Oleafly/discussions).
Report a bug or request a feature in
[GitHub Issues](https://github.com/Oleafly/Oleafly/issues).

Oleafly is built by [Prajwal Murthy](https://github.com/prajwal-svm) and
contributors. Templates, code, documentation, and feedback from your own
writing all help shape the project. Read the [contributing guide](CONTRIBUTING.md)
to take part.

If Oleafly makes your writing easier, [give it a ⭐ on GitHub](https://github.com/Oleafly/Oleafly) so the next researcher can find it too.

[Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](LICENSE)
