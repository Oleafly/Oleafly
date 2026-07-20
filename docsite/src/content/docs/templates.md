---
title: "Templates"
description: "The template gallery: 19 ready-to-edit starting points from ATS-safe resumes to IEEE papers, theses, Beamer decks, and posters, with previews, search, and on-demand fonts."
---

Every Oleafly project starts from a template. The gallery gives you a real page-one preview of each one, so you pick by looking at the output, not by guessing from a name. Templates ship as plain, editable LaTeX source: what you create is yours.

![The template gallery with category rail, search, and page-one previews](/Oleafly/media/project-templates.png)

## The gallery

Click **New project** in the library (or type `/create` in the search omnibar) and the two-step dialog opens:

1. **Choose a template.** Browse by category in the left rail, type in the **Search templates** box, or switch on the **ATS-friendly** filter to see only resume templates that parse cleanly. Every card shows a preview of the compiled first page.
2. **Name your project.** You'll see the template's full details: its preview, category, an **ATS-friendly** or **Design-forward** badge for resumes, the compile engine, and its license and author. Pick a project name (each template suggests a sensible placeholder) and a cover color, then hit **Create project**.

## The catalog

| Template | Category | What you get |
|---|---|---|
| **Blank document** | Blank | A minimal article to start from scratch. |
| **Diagram / Figure** | Diagrams | A standalone TikZ figure project; previews as an image and pairs with the [diagram composer](/Oleafly/figures-diagrams/). |
| **ATS Resume** | Resume | Single-column, ATS-friendly resume with clean section rules. |
| **Software Engineer Resume** | Resume | A polished one-page SWE resume, pre-filled as a senior example so you edit instead of invent. |
| **Sidebar Resume** | Resume | Design-forward two-column layout: colored sidebar, photo placeholder, skills on the left, experience on the right. |
| **Modern Resume** | Resume | Single-column ATS-friendly resume set in the Lato typeface. |
| **IEEE Research Paper** | Journals | Two-column IEEEtran conference paper with figures, tables, equations, and a bibliography. |
| **Academic Article** | Journals | Minimalist single-column research article with abstract and bibliography. |
| **ACM Article** | Journals | The official acmart class: authors, abstract, CCS concepts, references. |
| **Elsevier Article** | Journals | The elsarticle class: affiliations, abstract, keywords, bibliography. |
| **Homework Assignment** | Assignments | Title block, running header, numbered problems with solution space. |
| **Bibliography (natbib)** | Bibliographies | A natbib + BibTeX starter with a sample `.bib` and citation examples. |
| **Thesis / Report** | Theses & Reports | Title page, table of contents, chapters, bibliography. |
| **Book** | Books | Parts, chapters, front matter, table of contents. |
| **Beamer Presentation** | Presentations | A beamer deck: title, outline, content frames, closing slide. Exports to PowerPoint too. |
| **Newsletter** | Newsletters | Masthead, lead story, short columns in a two-column layout. |
| **Research Poster** | Posters | A tikzposter scientific poster: title banner, author block, column blocks. |
| **Monthly Calendar** | Calendars | A one-page monthly grid with roomy cells. |
| **Formal Letter** | Letters | Sender and recipient blocks, date, salutation, body, signature. |

All templates compile with the bundled Tectonic engine out of the box, and each one includes its license text (all permissive).

## Resume templates and ATS

The resume templates are split honestly:

- **ATS-friendly** (green badge): ATS Resume, Software Engineer Resume, Modern Resume. Single column, linear reading order, no layout tables, real text. These are built so applicant tracking systems extract everything.
- **Design-forward** (amber badge): Sidebar Resume. It looks striking, and the badge is your heads-up that multi-column layouts can trip strict parsers.

Whichever you pick, run [Preflight](/Oleafly/preflight/) before submitting: it simulates a resume parser against your actual PDF and shows what was extracted.

![Creating a resume from a template](/Oleafly/media/hero-editor.gif)

## On-demand fonts (the Setup badge)

Templates that use premium open-source typefaces (like the Lato-based Modern Resume) show a small **Setup** badge in the gallery. Creating one triggers a one-time font download with live progress, and the fonts are copied into the project's own `fonts/` folder, so the project stays self-contained and compiles offline from then on.

You can pre-download or remove these font packs anytime in Settings, Offline & Downloads. Details in [Settings](/Oleafly/settings/#offline--downloads).

## After creation

The new project opens immediately with the template's structure in the [file tree](/Oleafly/files/): the main document, any `.bib`, and assets. Compile once (**⌘↵** / Ctrl+Enter) and start replacing the sample content with your own. Nothing in a template is locked; it's ordinary LaTeX you can reshape freely.
