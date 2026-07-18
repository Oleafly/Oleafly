---
title: "The editor"
description: "A CodeMirror 6 LaTeX editor with a formatting toolbar, VSCode-style find and replace, code folding, Vim mode, multi-cursor editing, and a linter that catches errors before you compile."
---

Oleafly's editor is built on CodeMirror 6 and tuned for LaTeX. Line numbers, soft wrapping, bracket matching, and an active-line highlight are always on; everything else on this page is a click or a shortcut away.

Shortcuts below show the macOS key first; on Windows and Linux, read ⌘ as Ctrl.

## The toolbar

A formatting toolbar sits above every `.tex`-family file, left to right:

- **Undo (⌘Z)** and **Redo (⌘⇧Z)**
- **Heading** menu: inserts `\part`, `\chapter`, `\section`, `\subsection`, `\subsubsection`, or `\paragraph`
- **Bold (⌘B)**: wraps the selection in `\textbf{…}`
- **Italic (⌘I)**: wraps the selection in `\textit{…}`
- **Insert link**: `\href{}{}`
- **Add citation**: opens the [citation lookup](/OpenLeaf/citations/) (DOI, arXiv, or title)
- **Insert cross-reference**: `\ref{}`
- **Insert figure**: a complete `figure` float with `\includegraphics`, `\centering`, and `\caption`
- **Insert table**: a `table` float with a starter `tabular`
- **Insert list** menu: bulleted (`itemize`) or numbered (`enumerate`)
- **Code intelligence** menu: go to definition, find references, rename symbol (see [Code intelligence](/OpenLeaf/code-intelligence/))
- **Find (⌘F)**: opens find and replace

The same inserts, plus **Ask AI** and **Generate figure from selection**, live in the right-click menu, so nothing requires a trip to the top of the screen.

With ⌘B and ⌘I, the cursor lands inside the braces when nothing is selected, so you can keep typing without repositioning.

## Find and replace

Press **⌘F** for a VSCode-style widget in the top-right corner of the editor:

- **Match case** (`Aa`), **whole word** (`ab`), and **regular expression** (`.*`) toggles
- A live match counter (`3 of 41`), with `No results` and `Invalid` states, capped at `2000+` for huge documents
- **Enter** jumps to the next match, **Shift+Enter** to the previous, **Esc** closes
- **Select all matches** turns every match into a cursor for simultaneous editing
- The chevron expands the **Replace** row: replace next, replace **All**, and a **Preserve case** toggle that maps the original token's casing onto the replacement (so replacing `figure` with `image` also turns `Figure` into `Image`)

## Code folding

Click the arrow in the gutter to collapse a `\begin…\end` environment (nesting-aware) or a section (it folds until the next section of the same or higher level). Perfect for getting a 40-page chapter out of the way while you edit the conclusion.

## Multi-cursor and block selection

The editor supports multiple selections: **Alt-drag** for a rectangular (column) selection, and **Select all matches** in the find widget for one cursor per match. Every cursor types, deletes, and pastes together.

## Indentation and brackets

Four-space indent unit with auto-indent as you type. **Tab** indents (or accepts the open autocomplete suggestion). Brackets and quotes auto-close, backspace removes pairs together, and the matching bracket highlights at the cursor.

## Vim mode

Settings, General, **Vim mode** (or run "Enable vim mode" from the ⌘K palette) switches on full Vim keybindings: `hjkl`, operators and text objects (`dd`, `ciw`), `:w`, visual mode, the lot. It applies live, no restart, and all the Oleafly shortcuts on this page keep working alongside it.

## The built-in LaTeX linter

The editor checks structural problems as you type, before any compile:

- `\end{itemize}` without a matching `\begin`, or mismatched pairs (`expected \end{figure}, got \end{table}`)
- Unclosed environments
- Duplicate `\label{}` keys
- An odd number of `$` on a line (almost always a forgotten math delimiter)

Errors get red squiggles, warnings amber, with markers in the gutter. Compile errors from the actual LaTeX run appear separately in the [Logs pane](/OpenLeaf/compiling/#reading-the-logs), and [Preflight](/OpenLeaf/preflight/) adds its own source-level checks inline.

## Word count

Run **Word count** from the ⌘K palette for words, characters, and lines in the active file.

## More than .tex

Files open with highlighting matched to their extension: BibTeX, Markdown, JSON, YAML, TOML, CSS, shell scripts, and more. Images and PDFs open as rendered views instead of text, and binary formats are protected from accidental corruption; see [Files & folders](/OpenLeaf/files/#how-different-file-types-open).

## Related pages

- [Autocomplete & slash commands](/OpenLeaf/autocomplete/): completion for commands, references, citations, and the `/` insert menu
- [Code intelligence](/OpenLeaf/code-intelligence/): jump-to-definition, rename, hover cards, math preview
- [Spelling & grammar](/OpenLeaf/spellcheck-grammar/): offline Hunspell and Harper checking that understands LaTeX
- [Keyboard shortcuts](/OpenLeaf/keyboard-shortcuts/): the complete reference
- [Inline AI edits](/OpenLeaf/ai-inline-edit/): press ⌘L on a selection and describe the change
