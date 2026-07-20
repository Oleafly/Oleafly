---
title: "Getting started"
description: "From install to your first compiled PDF in about two minutes: create a project from a template, write, compile, jump with SyncTeX, and export."
---

In about two minutes you'll have a project open, compiled, and exported as a PDF. Everything runs locally, so you don't need an account or an internet connection to write or compile (only the very first compile fetches packages).

## 1. Install

Download the app for your platform from the [latest release](https://github.com/Oleafly/Oleafly/releases/latest) and open it. The builds aren't signed yet, so your OS warns on first launch; the [install guide](/Oleafly/install/#first-launch) has the one-time unlock for each platform.

## 2. Create your first project

On a fresh installation, choose **Show me around** on the welcome screen. The progressive guide introduces the library, creates a real project with you, and continues in the workspace. Settings, AI Assistant, and Diagram Composer each have a guide that appears on the first eligible visit. Manage individual guides and progress in **Settings → General → Enable tour guides**, or restart the guide for the current view from **Help & About → Start tour**.

1. On the Library home screen, click **New project**.
2. The template gallery opens. Browse by category, search, or filter by **ATS-friendly**. Try one of these to start:
   - **Blank document**: a minimal article to start from scratch.
   - **ATS Resume** or **Software Engineer Resume**: single-column resumes built to survive applicant tracking systems.
   - **IEEE Research Paper**: a two-column conference paper with figures, tables, and a bibliography.
3. Click your pick, give the project a name, choose a cover color, and hit **Create project**.

The full catalog of 19 templates is on the [Templates](/Oleafly/templates/) page.

## 3. Write and compile

Type in the editor on the left. Press **⌘↵** (Ctrl+Enter on Windows/Linux) to compile; the PDF appears on the right with zoom, page navigation, and single or two-page layouts.

Prefer compile-as-you-type? Open the command palette (**⌘K** / Ctrl+K) and run **Enable auto-compile**: from then on, a compile starts about 2.5 seconds after you stop typing.

While you write, the editor is already helping: type `\` for LaTeX command completion, `/` for the slash insert menu (`/figure`, `/table`, `/section`, `/cite`, `/math` and more), and **Ctrl+Space** to trigger suggestions anywhere. See [Autocomplete & slash commands](/Oleafly/autocomplete/).

## 4. Jump between source and PDF (SyncTeX)

- **Source to PDF:** put your cursor anywhere and press **⌘⇧J** (Ctrl+Shift+J). The PDF scrolls to the matching spot and flashes a highlight.
- **PDF to source:** hold **⌘** (Ctrl) and click any word in the PDF. The editor jumps to that exact word, even across `\input` files.

More in [SyncTeX](/Oleafly/synctex/).

## 5. Export

Click the **Export** button (download icon) in the toolbar, then **Export as PDF**. The output is ATS-clean by default: real selectable text with embedded fonts. The same menu exports your full source as a `.zip`, and Word, HTML, Markdown, and plain text via pandoc (downloaded on demand the first time). Details in [Export formats](/Oleafly/export/).

## 6. Where your files live

Every project is a plain folder under `~/.openleaf/projects/` containing your `.tex`, `.bib`, images, and a real `.git` repository. They're just files: browse, copy, or back them up with any tool. See [Where your data lives](/Oleafly/where-your-data-lives/).

## Keep going

- **Cite something:** paste a DOI or paper title and get a `\cite` plus a clean BibTeX entry. [Citations](/Oleafly/citations/)
- **Draw a figure:** the diagram composer generates editable TikZ from a visual canvas. [Figures & diagrams](/Oleafly/figures-diagrams/)
- **Connect an AI:** bring a key from any of nine providers, or run local with Ollama, and let the assistant fix your LaTeX errors. [Set up AI](/Oleafly/ai-setup/)
- **Check before you submit:** Preflight scores your PDF for resume parsers and screen readers. [Preflight](/Oleafly/preflight/)
- **Back it up:** publish the project to GitHub in two clicks. [GitHub sync](/Oleafly/github-sync/)
