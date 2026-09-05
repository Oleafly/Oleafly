---
name: Figure prep
description: Build and place publication-quality figures in an Oleafly manuscript. Use when the user wants a TikZ or pgfplots figure, a diagram, an architecture or pipeline drawing, a matplotlib or seaborn plot, a chart from a CSV, a multi-panel figure, subfigures, a colorblind-safe palette, correct figure sizing for a journal column, or help with captions, labels, includegraphics and cross-references.
license: MIT
compatibility: TikZ preview needs a LaTeX project (Tectonic or latexmk), since those are the engines with isolated compile. Matplotlib work needs Python 3.11 or newer on PATH and runs through approval-gated shell commands.
allowed-tools: read_file write_file create_file replace_in_file list_files search_project project_map compile get_log get_pdf_text verify_pdf_pages run_command preview_figure insert_figure load_image update_todos load_skill read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: figures
    tools:
      - preview_figure
      - insert_figure
      - load_image
      - read_file
      - write_file
      - create_file
      - replace_in_file
      - compile
      - get_log
      - verify_pdf_pages
      - run_command
      - project_map
      - load_skill
      - read_skill_file
---

# Figure prep

Figures carry the result. Get the encoding honest first, the layout second, and the caption last.

## 1. Decide what kind of figure this is

| The figure shows | Build it with | Route |
|---|---|---|
| Data: measurements, distributions, curves, comparisons | matplotlib or seaborn, exported to PDF | Section 4 |
| Structure: an architecture, a pipeline, a state machine, a proof sketch | TikZ, or pgfplots for data drawn in LaTeX | Section 3 |
| A concept with no underlying data | TikZ if it can be drawn precisely, otherwise hand off to **scientific-schematics** | Section 6 |
| Something the user sketched or screenshotted | `load_image` to look at it, then redraw it | Section 3 |

Before drawing anything, `load_skill` with id `scientific-visualization` and read `references/publication_guidelines.md`. Its non-negotiables apply here in full: never alter or hide data to improve a figure, keep bar baselines at zero, name what an error bar actually is, distinguish missing from zero, and never claim a palette or a DPI number makes a figure accessible.

## 2. Pick the mode, because the tools differ

Oleafly's assistant has two tool sets and only one is active per run.

| | Chat mode (default) | Figure mode |
|---|---|---|
| Turned on by | nothing, it is the default | the "Draw a figure" toggle in the composer |
| Available when | always | the project is LaTeX with isolated compile, which means the Tectonic and latexmk engines. Not Typst, not Markdown |
| Tools | `read_file`, `write_file`, `replace_in_file`, `compile`, `get_log`, `get_pdf_text`, `verify_pdf_pages`, `run_command`, `project_map`, everything else | `preview_figure`, `insert_figure`, `load_image`, and nothing else |
| Good for | writing figure files, running Python, wiring figures into sections, checking the whole document | iterating one TikZ figure fast and dropping it at the cursor |

Figure mode has no file access at all. It cannot read the manuscript, cannot compile the project, cannot run a command. If the user is in figure mode and asks for something outside those three tools, say which mode the request needs.

If figure mode is unavailable, say why in one line (the engine does not support isolated compile) and use the chat-mode route.

## 3. TikZ

`references/tikz-recipes.md` in this skill has Tectonic-safe starting points for boxes and arrows, grouping, pgfplots, colors, and sizing, plus what the isolated preview does and does not share with the manuscript.

### In figure mode

1. `preview_figure` with `code` (the `\begin{tikzpicture}...\end{tikzpicture}` body), plus `packages` and `libraries` it needs. `tikz` is always included; name libraries explicitly, for example `arrows.meta`, `positioning`, `fit`, `calc`, `backgrounds`, `patterns`.
2. Read `success`, `errors` and `log_tail`. On failure, fix and call again.
3. The rendered page is handed to the model when the model can see images, so iterate on what it actually looks like: overlapping labels, arrows landing on the wrong anchor, a node wider than its box.
4. `insert_figure` with the final `code`, a `caption` and a `label`. It wraps the code in `\begin{figure}[htbp]\centering ... \end{figure}` at the user's cursor and saves a PNG copy under `figures/<slug>.png`.

Two things to know about `insert_figure`:

- The document ends up holding the TikZ source inline, not an `\includegraphics`. The PNG under `figures/` is a reference copy, not what the PDF uses.
- It inserts `[htbp]`. Papers usually want `[t]`. Fix that afterwards in chat mode.

### In chat mode

1. `write_file` the figure to `figures/<name>.tex` containing just the `tikzpicture`.
2. `\input{figures/<name>}` inside a `figure` environment in the section that discusses it.
3. `compile`, then `verify_pdf_pages` on the page that holds it to see the result.

This is the only route on Typst or Markdown projects. Typst has no isolated figure compile, so draw with Typst's own `cetz` style primitives or place an exported image.

## 4. Matplotlib

Scripts live in the project so the figure is reproducible.

1. `create_file` a `scripts/` folder and `figures/` if they do not exist.
2. `write_file` `scripts/figure_<name>.py`. Keep the data path, the transformations and the seed inside the script.
3. `run_command` with `python3 scripts/figure_<name>.py`. This asks the user for approval, runs in the project directory, has a 120 second budget, and inherits the login shell environment. There is no sandbox, so keep the script to reading its input and writing its output.
4. Export **PDF** into `figures/`. Vector text stays sharp and searchable at any size.
5. `read_skill_file` `scientific-visualization` for depth: `references/journal_requirements.md` for sizes and formats, `references/color_palettes.md` for palettes, `assets/publication.mplstyle` and `assets/presentation.mplstyle` for style sheets, `assets/color_palettes.py` and `scripts/style_presets.py` for the presets, `scripts/figure_export.py` for an exporter that refuses silent overwrites and records provenance.

Those scripts sit in the skill directory, not the project. `load_skill` returns the absolute directory, so run one as `python3 "<skill dir>/scripts/style_presets.py"`, or copy the parts you need into the project script. They need Python 3.11 or newer.

`references/matplotlib-route.md` in this skill has the concrete shape of a figure script, the sizing table, and what to do when Python is missing.

## 5. Wire it into the manuscript

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\linewidth]{figures/architecture.pdf}
  \caption{System architecture. The encoder on the left feeds the fusion module.}
  \label{fig:architecture}
\end{figure}
```

Rules that are not negotiable:

- `width=\linewidth`, or a fraction of it. Not `\textwidth` inside a two-column layout.
- Caption **below** a figure, **above** a table. `\label` after `\caption`, never before, or every reference points at the enclosing section.
- Refer with `\cref{fig:architecture}` from cleveref, which writes the word for you. With plain `\ref`, put a `~` in front: `Figure~\ref{fig:architecture}`.
- `[t]` is the right default for papers. `[h]` alone is ignored by LaTeX. `[H]` from the `float` package forces placement and breaks page flow, so keep it for reports.
- Every figure is referenced from the text at least once. `project_map` reports labels; check nothing is orphaned.
- Full-width figure in a two-column layout: `figure*`.
- Subfigures come from `subcaption`. Never load `subfigure` or `subfig`.

Captions carry the claim. First sentence says what the figure shows, the rest says what to notice. A caption that only names the axes is wasted.

## 6. Hand off

- Conceptual diagrams that resist precise drawing: **scientific-schematics**. Read its `references/best_practices.md` and `references/iterative_refinement.md`. Its image-generation scripts are deliberately not bundled with Oleafly, because they call an external image service and read `.env` files from parent directories, so treat that skill as guidance and draw the figure here.
- Figure design theory, palettes, journal export rules: **scientific-visualization**.
- Compile failures anywhere in this loop: **oleafly-latex-build**.
- Figures for a deck or a poster: **oleafly-slides-and-posters**.

## Publication quality checklist

- [ ] The encoding is honest: zero baselines for bars, no truncated axis that manufactures an effect, missing data shown as missing
- [ ] Uncertainty is named in the caption, with `n` and the unit of replication
- [ ] Color is never the only cue. Every series also differs by marker, line style, hatch, or a direct label
- [ ] The palette survives grayscale and common color-vision deficiencies. Okabe-Ito is a safe default
- [ ] Font size at final printed size is close to the body text, roughly 7 to 9 pt for most journals. Set the figure's physical width, do not scale it in `\includegraphics`
- [ ] Vector (PDF) for plots and diagrams. Raster only for photographs and screenshots, at 300 dpi or better. Never JPEG for a plot
- [ ] Axis labels carry units. Tick labels are not scientific notation soup
- [ ] The figure is referenced from the text and the reference reads correctly in the PDF
- [ ] The caption states the claim, not just the contents
- [ ] It was looked at in the compiled PDF at final size, with `verify_pdf_pages` where available

## Failure handling

| Problem | What to do |
|---|---|
| `preview_figure` is not available | The project is not a LaTeX project, or figure mode is off. Use the chat-mode route |
| `insert_figure` returns declined | The user rejected the approval card. Ask what to change rather than re-sending the same figure |
| A TikZ library is missing from the bundle | Name it. Tectonic cannot install packages; offer the closest bundled alternative |
| `python3` is not found | Say so and offer the TikZ or pgfplots route instead. Do not install anything |
| The script needs a package that is not installed | Ask before installing. `run_command` inherits the user's environment and has no sandbox |
| The figure looks right in preview but wrong in the document | Column width. Re-check with the real `\linewidth` and `verify_pdf_pages` |
| `run_command` times out | The 120 second budget was exceeded. Split the work or cache the intermediate data |

## Artifacts

`figures/*.pdf` or `figures/*.png`, `scripts/figure_*.py` where Python was used, the figure environment in the manuscript, and a compiled PDF that shows the figure in place.

## Done when

- [ ] The figure compiles as part of the whole document, not only in isolation
- [ ] It is referenced from the text and the cross-reference resolves
- [ ] The caption and label are present, in the right order
- [ ] The checklist above was worked through, and anything skipped was named
- [ ] The source that produces it (TikZ code or Python script) is in the project
