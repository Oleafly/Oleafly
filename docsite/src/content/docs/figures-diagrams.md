---
title: "Figures & diagrams"
description: "The diagram composer: draw shapes and arrows visually or write TikZ by hand, preview the compiled result live, and insert as editable vector code or PNG. Round-trips for later editing."
---

Publication figures usually force a choice: a GUI tool that exports pixels and forgets, or hand-written TikZ with no visual feedback. Oleafly's diagram composer gives you both in one window, with a live compiled preview, and the figures it makes stay editable forever.

No API key, no network. This is a fully offline feature. (For AI-generated figures, see [Draw with AI](/OpenLeaf/ai-figures/).)

![The diagram composer: visual canvas, TikZ code, and live preview](/OpenLeaf/media/diagram-composer.png)

## Opening the composer

Click the **Insert diagram** button next to the compile button in the top toolbar, or run **Insert a diagram (manual)** from the search omnibar. The composer opens as a full-height window with your workspace on the left and a live preview on the right.

## The Draw tab

A visual canvas for the common case:

- **Shapes**: drag out rectangles, circles, ellipses, diamonds, and text blocks.
- **Connections**: draw arrows and lines between shapes; they stay attached when you move things.
- **Styling**: fill, border, and text colors per element.
- **Snap to grid** keeps everything aligned; **undo/redo** covers experiments.

As you draw, the composer generates clean TikZ from the canvas. You get GUI speed with LaTeX-native output: vector shapes, and labels typeset in your document's fonts.

## The Code tab

A real LaTeX editor for the TikZ itself, with syntax highlighting and a snippet toolbar for the building blocks (rectangle node, circle node, arrow edge, line edge, scope). Start from a drawing and fine-tune the generated code, or write the whole figure by hand; the **Preview** button compiles exactly what's in the editor.

If a compile fails and you have an AI provider connected, a **Fix with AI** button appears: it sends the TikZ and the compile log for a one-shot repair and recompiles. See [Draw with AI](/OpenLeaf/ai-figures/#fix-with-ai-in-the-composer).

## The live preview

The preview pane compiles your figure in isolation, in its own build sandbox, so your main document is never touched by a half-finished diagram. You can adjust the PNG scale and choose a transparent or page-colored background for raster output.

## Inserting

Give the diagram a name and pick how it lands in your document:

- **Insert as code (vector)**: the TikZ goes straight into your document. Infinitely scalable, themeable, and diffable in [Git history](/OpenLeaf/git-history/) like any other source.
- **Insert as image (PNG)**: an `\includegraphics` of a rendered `figures/<name>.png`, with your chosen scale and background. Right when the figure is heavy enough to slow the main compile.

Either way, the source is preserved as `figures/<name>.tikz`, and the name prompt warns before overwriting an existing figure.

## Round-tripping: figures stay editable

Drawn diagrams embed their model inside the saved `.tikz` file. The composer's **Load** button reopens any of them on the visual canvas, fully editable: move a box, restyle an arrow, re-insert. The same way draw.io ships editable exports, but with LaTeX-native output.

## Save as project

A diagram can also become a standalone **image project** on your library shelf (the **Save as project** option, or start one from the **Diagram / Figure** template). Image projects preview as the figure itself, and their [export menu](/OpenLeaf/export/) offers PDF (vector) and PNG (raster) directly. Useful for figures you reuse across papers.
