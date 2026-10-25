<div align="center">

<img src="https://cdn.oleafly.com/brand/logo/png/oleafly-app-icon-pastel-256.png" alt="Oleafly logo" width="112" height="112" />

# Oleafly <sup><em>beta</em></sup>

[Deutsch](docs/readme-translations/README.de.md) | **English** | [Español](docs/readme-translations/README.es.md) | [Français](docs/readme-translations/README.fr.md) | [日本語](docs/readme-translations/README.ja.md) | [한국어](docs/readme-translations/README.ko.md) | [Português](docs/readme-translations/README.pt.md) | [Русский](docs/readme-translations/README.ru.md) | [中文](docs/readme-translations/README.zh.md) | [العربية](docs/readme-translations/README.ar.md)

[![Download for macOS (Apple Silicon)](docs/assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Download for Windows](docs/assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest)
[![Download for Linux](docs/assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest)

[![Open issues](https://img.shields.io/github/issues/Oleafly/Oleafly?label=issues&color=22c55e)](https://github.com/Oleafly/Oleafly/issues) [![Downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOleafly%2FOleafly%2Fbadges%2F.github%2Fbadges%2Fdownloads.json)](https://github.com/Oleafly/Oleafly/releases) [![CI](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleafly/Oleafly/actions/workflows/ci.yml) [![Quality gate](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Oleafly_Oleafly) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=Oleafly_Oleafly&metric=coverage)](https://sonarcloud.io/component_measures?id=Oleafly_Oleafly&metric=coverage) [![Development status: ultra active](https://img.shields.io/badge/status-ultra_active-22c55e)](https://github.com/Oleafly/Oleafly/pulse) [![Last commit](https://img.shields.io/github/last-commit/Oleafly/Oleafly?label=last%20commit&color=22c55e)](https://github.com/Oleafly/Oleafly/commits/main) [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-22c55e.svg)](LICENSE) [![Discord](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdiscord.com%2Fapi%2Fv10%2Finvites%2Fkt9bcCjgkP%3Fwith_counts%3Dtrue&query=%24.approximate_member_count&suffix=%20members&label=&color=5865F2&logo=discord&logoColor=white&cacheSeconds=600)](https://oleafly.com/discord) [![Stars](https://img.shields.io/github/stars/Oleafly/Oleafly?style=social)](https://github.com/Oleafly/Oleafly)

**A live collaborative LaTeX, Typst & Markdown editor for research.**

Oleafly is a powerful editor for research writing in LaTeX, Typst and Markdown. The source, PDF, citations, figures, checks and Git history of a project all sit in one place. Write with your coauthors in real time, keep your projects in sync across computers, and bring Claude Code, Codex or any model you like into the project.

<p>
  <a href="https://github.com/Oleafly/Oleafly/releases/latest"><strong>Download free</strong></a>
· <a href="https://oleafly.com/docs/">Read the guides</a> · <a href="https://github.com/Oleafly/oleafly-server">Run a server</a> · <a href="docs/development.md">Build from source</a>
</p>


Free forever · Open source · No Oleafly account · No tracking

</div>

<div align="center">
  <img src="docs/assets/readme/hero-collab.png" alt="Oleafly with a LaTeX research paper open: the file tree, outline and structure on the left, the source with five coauthors' cursors and highlighted comments, and the compiled PDF" width="100%" />
</div>

## Why Oleafly

Everything here is free, including what other editors keep for paid plans: real-time collaboration with as many coauthors as you invite, full version history, Git and GitHub sync, Zotero, grammar checking and AI.

- Write with your coauthors in real time, with shared cursors and comments, on a server your lab sets up with one command.
- An editor made for long documents: completion for labels, citations and commands, live error checking, an outline of the whole project, Vim and Emacs keys, a visual mode and a searchable palette of 236 LaTeX symbols.
- Compile on your own computer. Tectonic, Typst and Pandoc are built in, and TeX Live, MacTeX, MiKTeX or TinyTeX take over when a project needs a full distribution.
- Click in the PDF to jump to the source and back, and the last good PDF stays on screen while you fix an error.
- Every project is a Git repository you can push to GitHub, GitLab, Gitea, Forgejo, Codeberg or your own Git server, and checkpoints save a snapshot after each successful compile.
- Cite from your Zotero library as you type, and search arXiv, Semantic Scholar, Crossref, PubMed and OpenAlex without leaving the editor.
- Spelling and grammar checks tuned for academic writing run on your computer.
- Preflight catches broken references, missing figures, fonts that didn't embed, accessibility gaps and anything that would unblind a review, before you submit.
- Draw figures that stay as TikZ, Typst or Mermaid code, and start from more than 1,700 templates for papers, theses, slides, posters and CVs.
- Import from Word, a PDF, an arXiv source, a Git repository or an online LaTeX account.
- The `oleafly` command builds, checks and syncs your projects from any terminal or CI job, with the same compilers and settings as the app.
- Cloud sync keeps your projects on every computer you use, and you can keep writing offline.
- Claude Code, Codex and 12 more agents work inside your project, or connect any model, local ones included. AI is optional, and each change it makes is a diff you can review and undo.
- Research tasks run a literature review, an evidence audit or a revision pass in a separate copy of the project while you keep writing, and you pick which changed files to keep. They are experimental and off by default; Settings > Experimentation turns them on.

## Write together, live

Share a project to your lab's Oleafly Server and everyone edits the same files at once. You see each person's cursor and selection, who's online, and what changed while you were away. Click someone's avatar to jump to the line they're working on.

<p align="center">
  <img src="docs/assets/readme/live-comments.png" alt="Two coauthors editing the same LaTeX file in Oleafly, with their cursors, avatars and the People and Activity pane" width="100%" />
</p>

- Comment on any selection in LaTeX, Typst or Markdown, then reply, mention someone, resolve or reopen. A mentioned coauthor gets one email, and can turn those off.
- Edits you make offline merge when you reconnect. If they overlap with someone else's, Oleafly shows you both and asks before it applies anything.
- AI edits, Zotero citations, renames, deletes and figures all travel too. If two people replace the same figure at once, both versions are kept.
- The main file, compiler, spelling language and Typst options are shared, so the whole team compiles the project the same way.
- Each project has an owner, editors and viewers. Guests invited by email see only the projects they were invited to.

### Run the server yourself

Oleafly Server installs with one command on a Linux machine, whether that's a lab workstation, a university VM or a small cloud server:

```bash
curl -fsSL https://oleafly.com/server/install.sh | sudo sh
```

It's a single Rust binary that uses SQLite, keeps files on disk or in any S3-compatible store, and sends email over SMTP if you set it up. People sign in with GitHub or any OpenID Connect provider, so your university's single sign-on works. There are ready-made configs for Docker Compose, Coolify, Render and systemd, and guides for Railway, Cloudflare Tunnel and university certificates.

Admins get a console in Oleafly for people, access rules, projects, email and the security log. Every device signs its changes, and the server builds each snapshot from that signed history instead of trusting uploads.

<p align="center">
  <img src="docs/assets/readme/server-admin.png" alt="Oleafly Server admin console showing people, access rules and the security log" width="100%" />
</p>

Read the [server guide](https://github.com/Oleafly/oleafly-server) for setup, backups and the full list of who can do what.

## Cloud sync across your computers

Turn on cloud sync and your library projects and app settings follow you from one computer to the next. Every download is checked against its record before it replaces a file, and a file you have open with unsaved changes is never overwritten.

<p align="center">
  <img src="docs/assets/readme/cloud-sync-dropbox.png" alt="Oleafly Cloud sync settings with the Dropbox card and a list of what syncs" width="100%" />
</p>

- When two computers edit the same file, both versions are kept, each named after the computer that wrote it.
- Deleting most of a project at once puts it on hold until you confirm, so one bad move can't empty it everywhere.
- Files deleted on another computer go to the Trash here instead of vanishing.
- On a new computer, Oleafly asks once whether to keep this computer's settings or the synced ones.

## Bring your projects with you

Moving from an online LaTeX editor? Sign in to your account once from Oleafly, pick the projects you want, and they come over with their files, compiler and main file, ready to compile. It works with a university's own server too.

With a Git token from that account, Oleafly can keep an imported project in sync both ways, so coauthors who stay online keep working the way they do now. Two-way sync uses the service's own Git integration, which needs a paid or university plan on the project owner's account.

<p align="center">
  <img src="docs/assets/readme/import-dialog.png" alt="Oleafly Import a project dialog with options for local files, arXiv, GitHub and an online LaTeX account" width="100%" />
</p>

You can also start from a project ZIP, a GitHub repository, a Word document, an arXiv source bundle, or a PDF that Oleafly rebuilds as editable LaTeX. Or open a folder where it already is.

## AI agents that work inside your project

Pick an agent from the catalog and it works in your project with the source, the PDF and the compile log in reach. Each agent signs in with its own account and uses its own model. Oleafly gives it the project and the tools around it.

<p align="center">
  <img src="docs/assets/readme/ai-agents.png" alt="An AI agent in Oleafly revising a section of a LaTeX paper, with the proposed change shown as a diff" width="100%" />
</p>

<div align="center">
<table>
  <tr>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/anthropic" alt="" width="40" height="40" /><br />Claude&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="https://api.iconify.design/logos:openai-icon.svg" alt="" width="40" height="40" /><br />Codex&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/googlegemini" alt="" width="40" height="40" /><br />Gemini&nbsp;CLI</td>
    <td align="center" valign="top" width="135"><img src="https://pi.dev/favicon.svg" alt="" width="40" height="40" /><br />Pi</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/opencode" alt="" width="40" height="40" /><br />OpenCode</td>
    <td align="center" valign="top" width="135"><img src="https://openclaw.ai/favicon.svg" alt="" width="40" height="40" /><br />OpenClaw</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/cline" alt="" width="40" height="40" /><br />Cline</td>
  </tr>
  <tr>
    <td align="center" valign="top" width="135"><img src="https://hermes-agent.nousresearch.com/favicon.ico" alt="" width="40" height="40" /><br />Hermes&nbsp;Agent</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/codebuddy" alt="" width="40" height="40" /><br />CodeBuddy</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/kimi" alt="" width="40" height="40" /><br />Kimi&nbsp;Code</td>
    <td align="center" valign="top" width="135"><img src="https://grok.com/images/favicon.svg" alt="" width="40" height="40" /><br />Grok&nbsp;Build</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/cursor" alt="" width="40" height="40" /><br />Cursor</td>
    <td align="center" valign="top" width="135"><img src="https://cdn.simpleicons.org/deepseek" alt="" width="40" height="40" /><br />DeepSeek Harness</td>
    <td align="center" valign="top" width="135"><img src="https://qoder.com/favIcon.svg" alt="" width="40" height="40" /><br />Qoder</td>
  </tr>
</table>
</div>

<p align="center"><sub>These marks identify compatible tools and remain the property of their respective owners. They do not imply endorsement.</sub></p>

Prefer a chat assistant? Connect a hosted provider, any OpenAI-compatible endpoint, or a local Ollama model.

- Every file change is a diff. Approve each one, let the assistant work on its own, or set rules per tool, and undo a single file or a whole turn.
- Plan mode maps the project before anything gets written.
- A literature review or a revision pass can run in its own Git worktree while you keep writing. You choose which changed files to keep.
- 39 research skills ship with the app, including literature sweeps, related work, claim checks and response letters.
- A local MCP server lets an outside AI client use the same project tools. It listens on 127.0.0.1 only.
- `oleafly mcp` gives Claude Code, Codex, Cursor and Gemini CLI the project tools over stdio, with the app open or closed.

AI is optional. The editor, compiler, PDF, citations, proofreading and checks all work with it off.

## LaTeX, Typst and Markdown, compiled on your computer

Tectonic, Typst and Pandoc ship with the app, so a new project compiles without installing anything. When a project needs a full TeX distribution, switch it to latexmk with TeX Live, MacTeX, MiKTeX, or a TinyTeX that Oleafly installs for you.

<p align="center">
  <img src="docs/assets/readme/editor-and-pdf.png" alt="Oleafly source editor and compiled PDF side by side, with a compile diagnostic linked to its source line" width="100%" />
</p>

- Click in the PDF to jump to the source, and back again. LaTeX uses SyncTeX, and Typst 0.13 or newer uses Tinymist.
- Compile errors link to the line that caused them, and the last good PDF stays on screen while you fix them.
- Visual mode lets you edit on a page-like view, with the source one click away.
- Completion and live diagnostics for labels, citations, commands, environments and file paths across the whole project.
- Spelling and grammar checks run locally and are tuned for academic writing.
- XeLaTeX, LuaLaTeX, and upLaTeX or pLaTeX for Japanese documents.

## Citations, figures, checks and templates

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/readme/citations.png" alt="Citing a Zotero entry by typing @ in the Oleafly editor" width="100%" />
      <h3>Cite from Zotero as you type</h3>
      Type <code>@</code> and part of an author, title or year to cite from your Zotero library. Oleafly adds only that entry to the project's <code>.bib</code>. Citation Search covers arXiv, Semantic Scholar, Crossref, PubMed and OpenAlex.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/readme/diagrams.png" alt="Oleafly Diagram Composer with a canvas and the TikZ code side by side" width="100%" />
      <h3>Draw figures that stay as code</h3>
      Diagram Composer draws on a canvas and writes TikZ, fletcher for Typst, or Mermaid. Change the drawing or the code and the other one follows.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/readme/preflight.png" alt="Oleafly Preflight listing reference, figure and accessibility findings" width="100%" />
      <h3>Check before you submit</h3>
      Preflight finds broken references, missing figures, fonts that didn't embed, accessibility gaps, and anything that would reveal the authors in a blind review. It has profiles for arXiv, IEEE, ACM, journals and theses.
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/readme/templates.png" alt="Oleafly template gallery with rendered previews of papers, theses and slides" width="100%" />
      <h3>Start from 1,700+ templates</h3>
      Articles, theses, Beamer talks, posters, CVs and venue-style papers, each with a rendered preview before you create the project.
    </td>
  </tr>
</table>

## Git, history and a terminal

Every project is an ordinary folder with an ordinary Git repository. Stage, diff, commit, push, pull and publish to GitHub, GitLab, Gitea, Forgejo, Codeberg or your own server from the Source Control panel, or use your own terminal, since nothing is hidden from it. Checkpoints save a local snapshot after each successful compile, so you can roll back without making a commit.

<p align="center">
  <img src="docs/assets/readme/git-history.png" alt="Oleafly Source Control panel with a diff, a branch graph and commit controls" width="100%" />
</p>

A terminal dock sits under the editor with up to ten tabs per project. Cmd-click (Ctrl-click) a file path in its output to open it at that line.

The `oleafly` command works on the same projects from any terminal: build, watch, check before you submit, sync with an online LaTeX service, or run the Oleafly agent without opening the app. Every command can print JSON with stable exit codes for scripts and CI. See the [command-line guide](docs/cli.md).

## And a lot more

<details>
<summary>40+ conversion, citation and math tools</summary>

The Tools gallery is in beta and off by default. Turn it on in Settings > Experimentation > LaTeX tools.

#### Import and format conversion

| Tool | Use it for |
| --- | --- |
| PDF to LaTeX | Reconstruct editable LaTeX from a PDF, with math, figures, and structure preserved where the source allows it |
| arXiv to LaTeX | Download an arXiv source bundle by ID, or unpack a saved archive from disk |
| Image to LaTeX | Turn an image of notes, equations, or a table into editable LaTeX |
| Equation to LaTeX | Convert typed math or an equation image into LaTeX |
| Excel to LaTeX | Convert an Excel, CSV, or TSV sheet into an escaped LaTeX table |
| HTML to LaTeX | Convert pasted HTML into a standalone LaTeX document |
| Image to Typst | Turn an image of notes, equations, or a table into editable Typst |
| LaTeX to HTML | Convert LaTeX to standalone HTML with MathML equations |
| LaTeX to Image | Render an equation and export a PNG or SVG |
| LaTeX to Markdown | Convert a LaTeX document into portable Markdown |
| LaTeX to Typst | Convert LaTeX into Typst source you can copy, save, or open as a project |
| LaTeX to Word | Create a Word document with equations stored as native Word math |
| Markdown to LaTeX | Convert Markdown notes into a standalone LaTeX document |
| Markdown to Typst | Convert Markdown notes into Typst source |
| Mermaid to LaTeX | Convert a Mermaid flowchart into editable TikZ code |
| PDF to Markdown | Extract a PDF's text layer, equations, and figures into Markdown |
| PDF to Typst | Extract a PDF's text layer, equations, and figures into Typst |
| Table to LaTeX | Build a LaTeX table in a visual row-and-column editor |
| Typst Editor | Start a Typst project with source editing, live preview, and PDF export |
| Visual Typst Editor | Start a Typst document in the project editor with live preview |
| Typst to LaTeX | Convert Typst markup into LaTeX for journals and submissions |
| arXiv to Typst | Convert an arXiv source bundle to Typst, with a compile check that lists what did not convert |
| CSV to Typst | Paste CSV or TSV rows and get an escaped Typst table |
| Equation to Typst | Convert typed LaTeX math or an equation image into Typst math |
| Excel to Typst | Convert an Excel, CSV, or TSV sheet into an escaped Typst table |
| HTML to Typst | Convert pasted HTML into a standalone Typst document |
| Mermaid to Typst | Convert a Mermaid flowchart into editable fletcher code |
| Typst to HTML | Convert Typst markup into standalone HTML with MathML equations |
| Typst to Markdown | Convert Typst markup into portable Markdown |
| Typst to Word | Create a Word document with equations stored as native Word math |
| Word to Typst | Convert a Word document into Typst and keep extracted media together |
| Word to LaTeX | Convert a Word document into LaTeX and keep extracted media together |

#### Math, tables, writing, and validation

| Tool | Use it for |
| --- | --- |
| BibTeX Validator | Check `.bib` files for syntax errors, missing required fields, and duplicate keys |
| Statistics Calculators | Calculate p-values, sample sizes, and confidence intervals locally |
| Writing Generators | Prepare an abstract, summary, paraphrase, or thesis outline from the open document with the assistant |
| Symbol Reference | Browse LaTeX symbols and insert one at the cursor, or its Typst name in a Typst file |

#### Literature, references, and research

| Tool | Use it for |
| --- | --- |
| Find Citations | Search scholarly indexes, scan a draft for missing support, and export BibTeX |
| arXiv Citation Generator | Look up an arXiv paper and format its citation in eight styles |
| Bibliography Generator | Build, validate, sort, and export a bibliography from structured details or BibTeX |
| Citation Generator | Turn article details or a scholarly identifier into a formatted citation and BibTeX |
| Citation Generators by Style | Compare one reference across APA, MLA, Chicago, IEEE, Harvard, Vancouver, AMA, and ACS |
| DOI to BibTeX | Retrieve a DOI record, review its fields, and export BibTeX |
| ISBN to BibTeX | Retrieve book metadata from an ISBN, correct it, and export BibTeX |
| PubMed to BibTeX | Retrieve a PubMed record from its PMID, review it, and export BibTeX |
| URL to BibTeX | Recognize DOI, arXiv, and PubMed links, or build an editable webpage citation |
| Lab Search | Find research institutions through the OpenAlex directory |
| Conference Deadlines | Filter conference deadlines, mostly in computer science, and view countdowns |

</details>

<details>
<summary>The 39 research skills that ship with Oleafly</summary>

Skills are ordinary `SKILL.md` folders that follow the Agent Skills shape. Run one with a slash command, add your own, or share them with compatible CLI agents on the same computer.

The bundled `research-core` pack ships 39 skills. The names below are the IDs used by the catalog and in project settings.

| Category | Skills |
| --- | --- |
| Research and literature | `citation-management`, `exploratory-data-analysis`, `hypothesis-generation`, `literature-review`, `oleafly-experiment-loop`, `oleafly-literature-sweep`, `oleafly-research-loop`, `openresearch`, `paper-lookup`, `research-lookup`, `scientific-brainstorming`, `scientific-critical-thinking` |
| Manuscript authoring and analysis | `experimental-design`, `oleafly-data-analysis`, `oleafly-manuscript-scaffold`, `oleafly-related-work`, `scientific-writing`, `statistical-analysis`, `statistical-power`, `venue-templates` |
| Figures and visualization | `oleafly-figure-prep`, `scientific-schematics`, `scientific-visualization` |
| Review and evidence | `oleafly-response-letter`, `oleafly-review-manuscript`, `oleafly-verify-claims`, `peer-review`, `scholar-evaluation` |
| Submission | `oleafly-pre-submission` |
| Communication | `oleafly-slides-and-posters`, `pptx-posters`, `research-grants`, `scientific-slides` |
| Tooling and automation | `desktop-apps`, `import-refine`, `oleafly-cli`, `oleafly-latex-build`, `pdf-to-latex`, `template-generate` |

</details>

<details>
<summary>Editor details</summary>

- A searchable palette of 236 LaTeX symbols, which inserts Typst names in Typst files.
- Vim and Emacs keybindings, multi-file tabs, folding, search and replace across the project, and word count.
- Rename or move a file and Oleafly updates the paths that point to it.
- Themes for light and dark mode, any installed font, editable syntax colors, and Zen mode.
- The interface is available in 21 languages.
- Command palette on Cmd+K (Ctrl+K), and one search box for projects, documents, settings and tools on Cmd+Shift+F (Ctrl+Shift+F).

</details>

## Get started

1. [Download Oleafly](https://github.com/Oleafly/Oleafly/releases/latest) for your computer.
2. Create a project from a template, import one, or open a folder you already have.
3. Press Cmd+Enter (Ctrl+Enter on Windows and Linux) to compile.
4. To write with others, click **Share** and send the project to your lab's Oleafly Server.

| Platform | Package | Download |
| --- | --- | --- |
| macOS · Apple Silicon | DMG | [![Download for macOS (Apple Silicon)](docs/assets/readme/download-glass-macos.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Windows · x86_64 | MSI or EXE | [![Download for Windows](docs/assets/readme/download-glass-windows.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · x86_64 | AppImage, DEB, or RPM | [![Download for Linux (x86_64)](docs/assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |
| Linux · ARM64 | AppImage, DEB, or RPM | [![Download for Linux (ARM64)](docs/assets/readme/download-glass-linux.svg)](https://github.com/Oleafly/Oleafly/releases/latest) |

On x86_64, the Linux packages need glibc 2.35 or newer (Ubuntu 22.04 or later). ARM64 packages are built on Ubuntu 24.04. Releases include signed update artifacts, and the in-app updater checks the signature before it installs anything.

## Questions people ask

<details>
<summary>Do I need an account?</summary>

Not an Oleafly account. You can write, compile and use Git without signing in to anything. Live collaboration signs you in to your lab's server with GitHub or your university's sign-in, and cloud sync signs in to your cloud storage.

</details>

<details>
<summary>Does it work offline?</summary>

Yes. Writing, compiling, the PDF, proofreading, preflight, Git and checkpoints all run on your computer. LaTeX builds offline once the bundled engine has the packages it needs, and Typst once its packages are cached. Shared projects keep your edits and merge them when you reconnect.

</details>

<details>
<summary>What goes over the network?</summary>

Only what you ask for: sharing with your server, cloud sync, literature and DOI lookups, GitHub, hosted AI providers, MCP servers you connect, and optional engine, package and template downloads. Release builds also check for an update when the app starts. A local Ollama model keeps AI traffic on your computer.

</details>

<details>
<summary>Can my university or company host the server?</summary>

Yes, that's the idea. Oleafly Server runs on your own machine or cloud account, signs people in through GitHub or any OpenID Connect provider, and stores files on disk or in S3-compatible storage. The [server guide](https://github.com/Oleafly/oleafly-server) covers installs, backups and roles.

</details>

## Learn more

- [Product guides](https://oleafly.com/docs/)
- [Oleafly Server](https://github.com/Oleafly/oleafly-server)
- [Feature map](docs/features.md)
- [Editor guide](docs/Editor.md)
- [PDF preview](docs/PDFPreview.md)
- [Citations and literature](docs/Citations.md)
- [Tools gallery](docs/Tools.md)
- [Preflight and accessibility checks](docs/Preflight.md)
- [Templates](docs/Templates.md)
- [Diagram Composer](docs/DiagramComposer.md)
- [Git and source control](docs/SourceControl.md)
- [Checkpoints](docs/Checkpoints.md)
- [AI Copilot](docs/AICopilot.md)
- [Skills](docs/Skills.md)
- [MCP integration](docs/mcp.md)
- [Command-line tool](docs/cli.md)
- [Development setup](docs/development.md)
- [Changelog](CHANGELOG.md)

## Community and support

Join the [Oleafly community on Discord](https://oleafly.com/discord) to ask questions, get help with a stubborn build, show what you're writing, and vote on what gets built next. It's free and open to everyone. Prefer GitHub? Report a bug or request a feature in [GitHub Issues](https://github.com/Oleafly/Oleafly/issues).

Oleafly is built by [Prajwal Murthy](https://github.com/prajwal-svm) and contributors. Contributions to code, templates, documentation, and feedback are welcome. Read the [contributing guide](CONTRIBUTING.md) to take part.

⭐ Help us reach more researchers and developers and grow the Oleafly community. [Star this repo](https://github.com/Oleafly/Oleafly)!

## Cite Oleafly

<details>
<summary>Copy the BibTeX entry</summary>

```bibtex
@software{oleafly,
  author  = {Venkateshmurthy, Prajwal S. and {The Oleafly contributors}},
  title   = {Oleafly: a local-first workspace for research writing},
  year    = {2026},
  version = {0.4.8},
  url     = {https://github.com/Oleafly/Oleafly},
  license = {AGPL-3.0-or-later}
}
```

</details>

[Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [AGPL-3.0-or-later](LICENSE)

## Star history

<a href="https://www.star-history.com/?repos=Oleafly%2FOleafly&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&theme=dark&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Oleafly/Oleafly&type=date&legend=top-left&sealed_token=aHz2JA-SBvmD73PyT7aCcCqMyAUvCPtidSAAvsQQxR8-1xdB-RZ-oXHKRnqIJUfSICl6Dd3_XPcHgb5Menvk_FfalfMb1GRbJC_TdeTMBVDi3jVUIXBBdovZ4dufhj4JWF3UXptJhw8pGmB6lqQ-X7gDOWu_bkPTQ7k-Q0VeBiq_jNgwRb7RSMgrSb-P" />
 </picture>
</a>
