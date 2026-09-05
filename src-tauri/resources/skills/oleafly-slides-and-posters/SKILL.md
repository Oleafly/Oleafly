---
name: oleafly-slides-and-posters
description: Turn the manuscript in the open project into a talk deck or a conference poster and compile it in place. Use when asked for slides, a presentation, a Beamer deck, a defense talk, a conference poster, or a PowerPoint version of a paper, when a deck has to be built for a 15 minute slot or a 45 minute seminar, or when a poster needs the right size and font scale for a printed board.
license: MIT
compatibility: A deck or a poster is an ordinary project file, not a separate project type. Beamer and beamerposter build with the bundled LaTeX engine. Typst decks need touying or polylux, which the Typst engine fetches when online. PowerPoint export is available from the Export menu for Beamer LaTeX projects only.
allowed-tools: read_file list_files search_project project_map create_file write_file replace_in_file compile get_log get_pdf_text verify_pdf_pages set_main_doc load_skill read_skill_file show_location update_todos
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: communication
    tools:
      - read_file
      - list_files
      - search_project
      - project_map
      - create_file
      - write_file
      - replace_in_file
      - compile
      - get_log
      - get_pdf_text
      - verify_pdf_pages
      - set_main_doc
      - load_skill
      - read_skill_file
      - show_location
      - update_todos
---

# Build slides and posters

The paper is already here. The job is to decide what fits in the time or on the board, and to build it as a file in this project.

## How this works in Oleafly

There is no slides engine and no poster project type. A Beamer deck is a LaTeX file whose class is `beamer`. A poster is a LaTeX file whose class is `beamerposter` or `tikzposter`. A Typst deck is a `.typ` file that imports a slide package. All of them are ordinary files in the project you already have open.

`set_main_doc` changes which file the project compiles, and it picks the engine from the extension: `.tex` compiles as LaTeX, `.typ` as Typst, `.md` as Markdown. It also changes what the preview pane shows. So the flow is always: write the file, point the project at it, compile, look at it, point the project back at the paper.

Restore the main document even when the compile failed. A project left pointing at a half-finished deck looks broken the next time the user opens it.

## 1. Pick the path

| Ask for | Path | File |
| --- | --- | --- |
| Talk, presentation, deck, defense, seminar | Beamer | `slides/main.tex` |
| Deck in a Typst project | Typst with touying or polylux | `slides/main.typ` |
| Poster, board, conference poster | beamerposter or tikzposter | `poster/main.tex` |
| Editable PowerPoint poster | Hand off to `pptx-posters` | outside this project |
| PowerPoint version of a Beamer deck | Beamer, then the Export menu | `.pptx` |

Match the path to the project. A Typst project should get a Typst deck, not a LaTeX one, unless the user asks otherwise. A LaTeX project should get Beamer.

Then ask, if you do not already know:

- How long is the talk, or how big is the board?
- Who is the audience: specialists, a mixed conference room, a committee?
- Is there a template the venue or the institution requires?

## 2. Derive the outline from the paper

Call `project_map` for the section list, labels, and figure references. Read the abstract, the introduction's last paragraph (which usually states the contribution), the results section, and the conclusion with `read_file`.

Then write the outline before you write any LaTeX. One line per slide, and each line is the message of that slide, not its title.

> Slide 7: the effect holds when we remove the largest site, so it is not driven by one hospital.

A slide whose message you cannot write in one sentence is two slides or no slide.

Put the outline in `update_todos` so the build is visible and the count stays honest.

Slide counts by talk length, and the section split, are in `assets/timing.md`. The short version: roughly one slide per minute, with data slides counting double and section dividers counting for nothing. A 15 minute conference talk is 15 to 18 slides. A 45 minute seminar is 35 to 45.

For a poster, the content budget is much smaller than authors expect. `references/poster.md` has the section word counts.

## 3. Build the file

Read the depth you need first:

- `references/beamer-deck.md` for the Beamer structure, frame patterns, and what to avoid
- `references/poster.md` for sizes, font scale, column layout, and the two poster classes
- `references/typst-and-pptx.md` for Typst decks and every PowerPoint route

When the `scientific-slides` skill is enabled, `load_skill` it and `read_skill_file` its assets for a fuller starting point:

- `assets/beamer_template_conference.tex` for a 15 minute conference talk
- `assets/beamer_template_seminar.tex` for a 45 to 60 minute seminar
- `assets/beamer_template_defense.tex` for a thesis defense
- `references/beamer_guide.md`, `references/slide_design_principles.md`, `references/talk_types_guide.md`

Those templates are full documents. Copy the preamble and the frame patterns you need with `write_file`, then replace the placeholder content with the real outline. Do not paste 400 lines of template and leave the sample content in it.

When `scientific-slides` is not enabled, or `read_skill_file` is not available in this run, start from `assets/slides-beamer.tex` and `assets/poster-beamerposter.tex` in this skill. Both compile on the bundled LaTeX engine as they are.

For a poster, the `venue-templates` skill carries `assets/posters/beamerposter_academic.tex` and `references/posters_guidelines.md`, which is the more complete source on sizes and typography. Reach it the same way.

Reuse the paper's figures. They are already in the project, usually under `figures/`. `list_files` to find them and point `\graphicspath` at the directory rather than copying files around. A figure built for a two-column paper often needs its fonts enlarged for a slide, so check it after the first compile.

Reuse the paper's bibliography the same way, but cite sparingly. A talk needs three or four citations, not forty.

## 4. Compile and look at it

1. `set_main_doc` to the deck or poster file
2. `compile`
3. `get_log` if it failed
4. `verify_pdf_pages` to see the rendered pages, when PDF page capture is on in Settings. It rasterizes up to six pages, so pick the ones with dense content. When the setting is off, use `get_pdf_text` and read the page count and the text flow
5. Fix what the pages show: text past the frame edge, a figure that swamps the slide, a table that has run off, a title that wraps to three lines
6. `set_main_doc` back to the paper

Overflow is the failure that matters and the one that never appears in the log. `Overfull \vbox` on a Beamer frame means content past the bottom of the slide, which the audience will not see. Split the frame.

## 5. Hand it over

Report in chat: the file path, the slide or panel count, the estimated timing against the requested length, and anything you had to leave out. Call `show_location` on the deck file so it opens.

Then run the checklist in `references/quality-checklist.md` and say which items you could not check.

## Decision points

| Situation | What to do |
| --- | --- |
| Typst project | Build a Typst deck. Note that Typst projects have no document conversion exports at all, so no PowerPoint |
| PowerPoint asked for | Only a Beamer LaTeX project gets the Export menu item. See `references/typst-and-pptx.md` for the alternatives |
| Editable PowerPoint poster asked for | Hand off to `pptx-posters`. That is a different deliverable with its own approval flow |
| Venue supplies a slide template | Use it. Adapt the outline to their structure, not the other way around |
| Talk is under 10 minutes | Cut to one result. Not one result per section, one result |
| Poster board size unknown | Ask. A0 portrait and 36 by 48 inches portrait are the common defaults but printing the wrong size wastes the board |
| Paper has no figures | Say so. A text-only deck is a bad deck, and the fix is making a figure, which is a separate task |
| The deck already exists | Read it first and revise it. Do not overwrite the user's work |

## When something goes wrong

- `beamerposter` or `tikzposter` is not in the bundle: `get_log` will say the class is missing. Switch to the other one and say why.
- A Typst deck fails on the package import: `touying` and `polylux` are fetched from the Typst package registry, which needs a network connection on the first compile. Offline, use a plain Typst page-per-slide layout instead.
- The compile succeeds but the PDF has one page: for Beamer, a missing `\end{frame}` swallows the rest of the document. For a poster, one page is correct.
- `verify_pdf_pages` returns nothing: the PDF capture setting is off. Say so once and continue with `get_pdf_text`.
- You changed the main document and the run ended early: tell the user which file to set back, by name.
- Frames overflow after adding a figure: shrink with `\includegraphics[width=0.8\textwidth]` before shrinking the font. Small text on a slide is worse than a smaller figure.

## Artifacts

- `slides/main.tex` or `slides/main.typ`, the deck
- `poster/main.tex`, the poster
- The compiled PDF for whichever was built last

## Done when

- Every slide has one message, and the message is in the outline.
- The slide count matches the time available.
- Every figure has been looked at in the rendered PDF, not just in the source.
- No frame overflows.
- Font sizes on a poster meet the minimums in `references/poster.md`.
- The project's main document is back to the paper.
