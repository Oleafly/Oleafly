# Typst decks and PowerPoint

## Typst decks

A Typst deck is a `.typ` file in a Typst project. Two packages do the work.

**touying** is the fuller of the two, with themes, section handling, and incremental reveals.

```typst
#import "@preview/touying:0.5.3": *
#import themes.university: *

#show: university-theme.with(
  config-info(
    title: [The claim, not the topic],
    author: [Name],
    date: datetime.today(),
    institution: [Institution],
  ),
)

#title-slide()

= Problem

== Why this matters

- One idea
- Another

== The result

#figure(image("../figures/ablation.png", width: 80%))
```

**polylux** is smaller and closer to the metal.

```typst
#import "@preview/polylux:0.4.0": *

#set page(paper: "presentation-16-9")
#set text(size: 25pt)

#slide[
  = Why this matters
  - One idea
]
```

Both are fetched from the Typst package registry on the first compile, which needs a network connection. Offline, neither will build. The fallback is a plain Typst document with a slide-sized page and one slide per page:

```typst
#set page(paper: "presentation-16-9", margin: 2cm)
#set text(size: 24pt)

#pagebreak(weak: true)
= Why this matters
```

Pin the version in the import. `@preview/touying:0.5.3` resolves to that release; leaving the version off does not work, and a floating version would change the deck under you.

Check the current version before writing the import rather than trusting the numbers above, which age.

## PowerPoint

There are three routes and only one of them is a button.

### From a Beamer deck, through the Export menu

The Export menu offers "Export as PowerPoint (.pptx)" when the project's main document is a LaTeX file whose class is `beamer`. Pandoc does the conversion, and Oleafly downloads Pandoc on demand the first time.

So the flow is: build the Beamer deck, `set_main_doc` to it, compile, and then tell the user to use Export as PowerPoint from the toolbar. There is no tool that triggers an export, so this step is the user's.

What survives the conversion: the frame structure as separate slides, headings, bullet lists, tables, images, and math as native PowerPoint equations. What does not: the beamer theme, colours, columns, blocks, overlays, and `\pause`. The result is an editable outline with the content in it, not a copy of the deck.

Check the slide count afterwards. If the whole deck arrives as one slide, the conversion did not split on frames.

### From a Markdown project

A Markdown project's engine declares pptx as a conversion format, but the Export menu decides which formats to show by reading the LaTeX `\documentclass` line, so a Markdown project never sees the PowerPoint item. The route that works is Pandoc through `run_command`, which needs approval:

```
pandoc --slide-level 2 -o slides.pptx -- slides.md
```

`--slide-level 2` is what makes each level-2 heading a slide. Without it a deck can collapse into one slide.

The Markdown slide structure Pandoc expects:

```markdown
% The talk title
% Author name
% Venue, date

# Section

## Why this matters

- One idea
- Another

## The result

![Ablation](figures/ablation.png)
```

Level-1 headings become section divider slides. Level-2 headings become content slides. A horizontal rule (`---`) also starts a new slide when there is no heading. Pandoc needs to run with the project as its working directory so relative image paths resolve, which `run_command` already does.

Pandoc has to be present. Oleafly downloads it on demand for its own export path, so the first Export from the menu installs it; after that the command-line route finds it too.

### Typst projects

The Typst engine declares no conversion exports at all, so there is no PowerPoint, Word, or HTML route from a Typst project. Compile to PDF and present that, or build the deck in Beamer instead.

## Editable PowerPoint posters

For a poster that has to be handed over as an editable `.pptx`, use the `pptx-posters` skill rather than converting a LaTeX poster. It builds a real one-slide `.pptx` from a manifest with exact physical dimensions, image DPI checks, and contrast checks, which is what a print shop and an accessibility review need.

That skill has its own gates: it wants the author's exact content, hashed local assets, confirmed printer requirements, and author approval bound to the manifest. Do not try to shortcut them. `load_skill` it and follow its workflow from the start.

Converting a `beamerposter` PDF to PowerPoint does not work. The result is one image on a slide with no editable text.

## Presenting the PDF

Most of the time the PDF is the deliverable and PowerPoint is not needed. A Beamer PDF in full-screen mode is what most academic talks run from, and it renders identically on every machine, which is the one thing a conference laptop cannot promise about a `.pptx`.

Take the PDF with you and take a copy on a USB stick. Both fit in the same bag.
