---
title: "Code intelligence"
description: "IDE-grade navigation for LaTeX: go to definition, find references, project-wide rename, hover cards, math preview, and the document outline."
---

Oleafly indexes your whole project, not just the open file: every `\label`, citation key, custom macro, theorem, glossary entry, and the `\input` graph connecting your files. That index powers navigation that LaTeX writing has mostly lived without.

Shortcuts show macOS keys; on Windows and Linux, read ⌘ as Ctrl.

## Go to definition: F12 or ⌘-click

Put the cursor on a `\ref`, a `\cite` key, a custom macro, a `\begin{env}` for an environment you defined, or a glossary term, and press **F12** (or hold ⌘ and click it). The editor jumps to where it's defined, opening the defining file if it's elsewhere in the project.

Pressing F12 while already on a definition flips to finding its references, the same convention IDEs use.

## Find references: ⇧F12

**Shift+F12** lists every use of the symbol in the **References** panel in the left rail: one row per occurrence with the file, line, and a preview, and a "def" badge on the definition itself. Click a row to jump. It's the fastest way to answer "can I delete this label?" or "where did I cite this paper?"

## Rename symbol: F2

**F2** renames a label, citation key, macro, theorem, glossary entry, or environment across the entire project in one step: the open file updates live, other files are rewritten on disk, and the index rebuilds. If the new name already exists, the rename is blocked before it can create a collision, and a toast reports how many edits landed in how many files.

Renaming `fig:overview` to `fig:architecture` and having all six `\ref`s follow is a two-second operation.

## Hover cards

Hover any symbol and a card explains it:

- On a **reference**: what kind of symbol it is, the definition's preview line, and its `file:line`.
- On a **definition**: how many references it has across the project.
- On anything **unresolved**: a clear "Unresolved" label, which is your earliest warning of a typo'd `\ref` or a missing `.bib` entry.

Hold ⌘ (Ctrl) while hovering and clickable symbols underline like links, click to jump.

## Math preview on hover

Hover over any inline `$…$`, `\(…\)`, or display `\[…\]` math and a tooltip renders it with KaTeX, so you can proofread a formula without compiling. Display math renders in display style; a broken expression shows the error instead of hiding it.

## The Outline panel

Below the file tree, the **Outline** panel shows your document's structure: sections indented by level, plus `\input` includes, across all files. Items from other files carry a filename badge. Click anything to jump straight to it. For a thesis split across a dozen chapter files, this is the table of contents you navigate by.

The panel divider between the tree and the outline drags to resize.

## Where the toolbar and menu fit

All three navigation commands also live in the editor toolbar's **Code intelligence** menu (the braces icon) and the right-click menu, so they're discoverable before the shortcuts become muscle memory.

## The AI sees the same index

The [AI assistant](/OpenLeaf/ai-chat/) has a `project_map` tool built on this same index: the outline, labels, citations, macros, file graph, and any unresolved references. When you ask it about "the methodology section," it can actually find it.
