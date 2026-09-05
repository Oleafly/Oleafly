---
name: oleafly-pre-submission
description: Run a pre-flight pass over the project before uploading to arXiv or a venue, and write a pass or fail checklist. Use when preparing an arXiv submission or a camera-ready, when checking anonymity for a double-blind venue, page limits, reference style, or supplementary material rules, when hunting undefined references, missing fonts, or figure problems that only surface at the publisher, or when building a clean source bundle to upload.
license: MIT
compatibility: Any Oleafly project. The compile and log checks need a project that builds. arXiv source rules apply to LaTeX projects only. Venue depth improves when the venue-templates skill is enabled.
allowed-tools: read_file list_files search_project project_map compile get_log get_pdf_text verify_pdf_pages create_file write_file run_command load_skill read_skill_file show_location update_todos
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: submission
    tools:
      - read_file
      - list_files
      - search_project
      - project_map
      - compile
      - get_log
      - get_pdf_text
      - verify_pdf_pages
      - create_file
      - write_file
      - run_command
      - load_skill
      - read_skill_file
      - show_location
      - update_todos
---

# Pre-submission check

Everything that goes wrong at upload time is findable beforehand. This runs the checks and writes down what passed, what failed, and what only the author can decide.

Output is `submission/checklist.md` with a verdict per item. You do not fix things silently. You find them, report them, and fix only what the user asks you to fix.

## 1. Establish the target

Ask, or state your assumption:

- arXiv, a journal, a conference, or more than one?
- Initial submission, revision, or camera-ready? The rules differ at each stage.
- Double-blind, single-blind, or open?
- Which year and track?

The rules that matter are on the venue's current call for papers. Anything bundled here or in `venue-templates` is a snapshot that may be stale. Never state a page limit or a deadline from memory. Say where the number came from, or ask the user to confirm it.

When the `venue-templates` skill is enabled and `read_skill_file` is available, `load_skill` it and pull what applies:

- `references/conferences_formatting.md`
- `references/journals_formatting.md`
- `references/reviewer_expectations.md`

Then use `references/venue-rules.md` in this skill for the checks that apply regardless of venue.

## 2. Build clean

1. `compile`. Zero errors is the bar. A warning-free build is the goal.
2. `get_log` and scan for the warnings that matter. `references/log-warnings.md` lists them with what each means and whether it blocks.
3. `project_map` and read `unresolvedRefs` and `unresolvedCites`. Both must be empty. A `??` in the PDF is the single most common thing an author ships by accident.
4. `get_pdf_text` and read the rendered text end to end. Look for `??`, `[?]`, a missing figure box, a truncated table, an orphaned heading, or a bibliography that stopped early.

Record the page count and compare it against the venue limit. Count what the venue counts: some exclude references, some exclude the appendix, some count everything.

## 3. Source hygiene for arXiv

Only for arXiv, and only for LaTeX sources. Read `references/arxiv-checks.md` in full and work through it. The short version, each of which is a checklist row:

- The source builds with the engine arXiv will use. arXiv runs pdfLaTeX by default; Oleafly compiles with Tectonic, which is XeTeX. A document needing `fontspec` will not build on arXiv's default path.
- `\pdfoutput=1` within the first few lines of the main file when the document is meant to be built as PDF output.
- The `.bbl` file is included. arXiv does not run BibTeX or Biber for you.
- No absolute paths in `\input`, `\include`, `\includegraphics`, or `\bibliography`.
- File names are plain ASCII with no spaces, no leading dots, and no two files differing only by case.
- Figures are PDF, PNG, or JPEG. No `.bmp`, no `.tif`, and no mixing an `.eps` and a `.pdf` of the same figure.
- Fonts are embedded, and none of them are Type 3 bitmaps.
- Supplementary material that is not compiled sits in `anc/`.
- The abstract for the metadata field fits arXiv's character limit. Check it before you open the form.
- The license choice is deliberate. It cannot be changed after announcement.

## 4. Front matter and metadata

- Title matches between the manuscript, the metadata, and any cover letter.
- Abstract present, within the venue's word limit, and free of undefined macros, citations, and references to figures.
- Author list complete, in the agreed order, with affiliations and any required identifiers.
- Corresponding author and contact details where required.
- Keywords or subject categories chosen.
- Funding, acknowledgements, data availability, code availability, ethics, and conflict statements present where the venue asks for them.

For a double-blind venue, all of the following must be absent from the submission: author names, affiliations, acknowledgements, funding statements naming a grant holder, a repository URL that identifies the group, self-citations written in the first person ("in our previous work [12]"), and identifying metadata in the PDF. Search for them with `search_project` rather than trusting a read-through. `references/venue-rules.md` has the search patterns.

## 5. Figures and tables

- Every figure and table referenced from the text.
- Raster figures at the resolution the venue asks for, usually 300 dpi for photographs and 600 or more for line art. Vector where the figure is a plot or a diagram.
- Text inside figures readable at print size, and no smaller than the caption text.
- Colour is not the only encoding, and the palette works for colour-blind readers.
- Captions self-contained: what is shown, what n is, what error bars mean.
- Nothing important sitting outside the trim area or in the gutter.

Use `verify_pdf_pages` to look at the rendered pages when PDF page capture is on in Settings. It rasterizes up to six pages, so pick the pages with figures. When it is off, fall back to `get_pdf_text` and `list_files`.

## 6. Licensing, consent, and integrity

- The target venue's preprint policy allows an arXiv posting at this stage.
- The arXiv licence does not conflict with a later copyright transfer, and is irreversible after announcement.
- Third-party and reused figures carry permission and attribution.
- Ethics, consent, and data governance statements present where they apply.
- Author contributions and conflicts declared.

## 7. Build the bundle

`list_files` and decide what goes up. Exclude:

- `.oleafly/` and everything under it, including `build`
- `.git/`
- editor and OS junk: `.DS_Store`, `._*`, `*.swp`, `*~`
- compile intermediates the venue does not want, except the `.bbl`, which arXiv needs
- large source data that belongs in a repository

For a ZIP of the whole project, use the app: the Export menu has "Export as ZIP", which excludes application metadata and git internals for you.

For an arXiv upload, the tarball is a specific list of files, not the whole project. Name the files in the checklist. On macOS, build it with `COPYFILE_DISABLE=1` so BSD tar does not embed `._` resource forks.

## 8. Write the checklist

`create_file` then `write_file` for `submission/checklist.md`, following `assets/checklist-template.md`. Each row carries the item, the verdict, and the evidence:

| Item | Verdict | Evidence |
| --- | --- | --- |
| Compiles with zero errors | pass | `compile` returned success, log has no error lines |
| No unresolved references | fail | `project_map` reports unresolvedRefs: `fig:ablation`, `tab:main` |
| Page count within limit | needs decision | 9 pages of body, venue limit unconfirmed by the author |

Three verdicts only: `pass`, `fail`, `needs decision`. Anything you could not check is `needs decision` with a note saying why, never a silent pass.

Then `show_location` on the first two or three failures, and report in chat: how many failures, what they are, and where the checklist is.

## Decision points

| Situation | What to do |
| --- | --- |
| Venue unknown | Run every general and arXiv check, mark the venue-specific rows `needs decision` |
| Compile fails | Stop the pass. A failing build makes every downstream check meaningless. Report the first error. |
| Document needs XeTeX or LuaTeX and the target is arXiv | Flag it as a `fail` with two options: make the source pdfLaTeX-compatible, or submit a PDF-only version |
| Double-blind and an author name appears anywhere | `fail`, with every location listed |
| Page count over the limit | `fail`. Do not start cutting text yourself unless asked. |
| PDF page capture is off | Note it in the checklist and do the figure pass from the source and `get_pdf_text` |
| The user asks you to fix the failures | Fix them one at a time, recompile after each, and rerun the checklist at the end |

## When something goes wrong

- `get_log` is truncated: the log is capped, so recompile and read it immediately, or search the source for the construct the last visible error mentions.
- `project_map` is not offered: fall back to `search_project` for `\ref{`, `\cite{`, and `\label{` and reconcile by hand.
- `run_command` is declined: everything except the tarball build can be done with the project tools. Say which check you skipped.
- Fonts cannot be checked without external tools: mark the row `needs decision` and point the user at the PDF reader's document properties.
- A venue rule cannot be confirmed: `needs decision`, with the exact question the user should answer. Never guess a number.

## Artifacts

- `submission/checklist.md`

## Done when

- Every row has a verdict and evidence.
- No row is `pass` on an assumption.
- The failures are listed in chat, worst first.
- The user knows exactly which decisions are theirs.
