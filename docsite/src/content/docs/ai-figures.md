---
title: "Draw figures with AI"
description: "Describe a figure and get publication-quality TikZ: compiled in isolation, refined by vision models, inserted at your cursor with the editable source preserved."
---

Describe the figure; the assistant draws it. The figure studio turns "a transformer encoder with 6 stacked blocks" or a selected paragraph of your paper into real, editable TikZ, compiled and previewed before a single character lands in your document.

## Opening the studio

Three ways in:

- The **sparkles toggle** in the chat panel header ("Draw a figure").
- **Generate a figure with AI** in the search omnibar.
- Right-click a paragraph in the editor and choose **Generate figure from selection**: the paragraph becomes the brief, and the finished figure can replace it.

## How it works

The studio is an agent specialized for figures:

1. It drafts TikZ (or PGFPlots) from your description.
2. It compiles the figure **in isolation**, in its own build sandbox, so a broken draft never touches your document or its PDF.
3. It iterates: compile errors feed back into the next draft automatically.
4. **With a vision model** (GPT-4o and friends, Claude, vision-tagged Ollama models), it goes further: after each compile it looks at the rendered image and fixes overlaps, spacing, and alignment on its own before showing you.
5. When you accept, it inserts the figure at your cursor (or over the selected paragraph), wrapped in a proper `figure` environment with caption and label, and saves a PNG copy under `figures/`.

The insert is an approval card like any other [AI edit](/Oleafly/ai-chat/#you-approve-every-change), with an image preview of exactly what you're accepting.

With a text-only model you still get the full loop; you steer visually using the preview in the approval card while the model works from the compile log.

## From a sketch

Drop a photo of a hand-drawn sketch into the project (or attach it in chat) and ask the studio to reproduce it as a clean figure. The `load_image` tool lets the model study any image already in your project.

## Fix with AI, in the composer

The manual [diagram composer](/Oleafly/figures-diagrams/) has its own one-shot AI assist: when a compile of your hand-written TikZ fails, a **Fix with AI** button sends the code plus the error log to your active model, drops the corrected code back into the editor, and recompiles. One click, no conversation.

## Why TikZ output matters

The studio never hands you a PNG as the primary artifact. You get LaTeX-native vector source: it scales to any size, matches your document's fonts, diffs cleanly in [Git history](/Oleafly/git-history/), and remains editable by hand or by the [composer](/Oleafly/figures-diagrams/) forever. The saved `figures/<name>.png` is a convenience copy, not the source of truth.

## Requirements

A connected provider ([set up AI](/Oleafly/ai-setup/)), with vision refinement kicking in automatically when the model supports it. Everything else, including the isolated compiles, runs locally.
