---
title: "SyncTeX"
description: "Bidirectional source-PDF navigation: jump from the cursor to the exact spot in the PDF, or Cmd/Ctrl-click a word in the PDF to land on it in the editor, across files."
---

SyncTeX is the invisible thread between your LaTeX source and the typeset PDF. OpenLeaf compiles with SyncTeX data enabled on every build, so both directions of the jump are always one gesture away.

![Cmd-click the PDF and land on the exact word in the source](/OpenLeaf/media/synctex.gif)

## Source to PDF: ⌘⇧J

Put your cursor on any line and press **⌘⇧J** (Ctrl+Shift+J). The PDF scrolls to the matching spot and flashes a blue highlight over it for a moment, so your eye lands exactly where your cursor was.

Two more ways to trigger it: the arrow button on the divider between the panes, and **Go to PDF (SyncTeX)** in the ⌘K palette.

It works across multi-file projects: a cursor inside `chapters/methods.tex` finds its typeset position in the combined PDF, because SyncTeX follows your `\input` structure.

## PDF to source: ⌘-click

Hold **⌘** (Ctrl); the pointer over the PDF becomes a crosshair. Click any word and the editor jumps there, opening the right file first if the text came from an `\input` child.

OpenLeaf goes one step further than line-level SyncTeX: it reads the PDF's text layer to identify the exact word you clicked and places your cursor on that word, not just at the start of the line.

One precedence rule: ⌘-clicking a hyperlink in the PDF follows the link behavior instead of jumping.

## When a jump does nothing

SyncTeX data comes from the last compile, so it can go stale:

- **You edited since the last build.** Recompile (**⌘↵**) and jump again.
- **The line produces no visible output** (a comment, a preamble line, a blank line). Put the cursor on a line with typeset text.

## Where it doesn't apply

- The [detached preview window](/OpenLeaf/pdf-preview/#a-second-monitor-the-detached-preview-window) mirrors the PDF but doesn't accept SyncTeX clicks; jump from the main window.
- Image projects (standalone figures) skip SyncTeX; a one-page figure doesn't need it.
