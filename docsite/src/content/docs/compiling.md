---
title: "Compiling"
description: "The bundled Tectonic engine: one-key and auto-compile, live progress, the status chip, reading the logs, offline mode, and how packages are fetched and cached."
---

Oleafly compiles with **Tectonic**, an XeTeX-based engine that ships inside the app. There is no TeX distribution to install and no build configuration: open a project, press compile, get a PDF. Output is Unicode-clean with embedded, subsetted fonts, which is exactly what ATS parsers and archives want.

## Starting a compile

- **⌘↵** (Ctrl+Enter), anywhere.
- The **Compile** button at the top right of the toolbar.
- **Recompile** in the ⌘K command palette.
- Opening a project into a view that shows the PDF pane compiles once automatically, so you land on a fresh preview.

Compiling always saves the active file first, so the PDF matches what you see. If you're in editor-only view, compiling reveals the split view so you can watch the result.

## Auto-compile

Run **Enable auto-compile** from the ⌘K palette and Oleafly recompiles about 2.5 seconds after you stop typing. Only real edits trigger it; switching tabs or opening files doesn't. It's off by default, and the same palette entry turns it back off.

Compiles never pile up: if you keep typing while a build runs, exactly one follow-up compile is queued so the final PDF always reflects your latest edits.

## Watching progress

A thin progress bar runs across the top of the preview during a build, and before the first PDF exists the pane shows a percentage estimate. When a build finishes, the toolbar shows a **status chip** with the compile time and a severity icon:

- Green check: compiled successfully.
- Amber triangle: compiled with warnings. You still get the PDF.
- Red cross: compiled with errors.

The preview switches to the PDF automatically on success. Only a genuine failure (no PDF produced) switches you to the Logs view.

## Reading the logs

The **Logs** button at the left of the preview toolbar flips between the PDF and the compile log, with a badge counting errors (red) or warnings (amber):

- A parsed **diagnostics list** up top: each error or warning with its kind and, when known, the `l.42` line reference.
- The full raw TeX log below, colorized: errors bold red, line references highlighted, file nesting indented.
- A **Copy log** button grabs the whole thing for a bug report or a forum post.

Compile errors also become squiggles in the editor via the [linter pipeline](/Oleafly/editor/#the-built-in-latex-linter), and the [AI assistant](/Oleafly/ai-chat/) can read this same log with its `get_log` tool when you ask it to fix the errors.

## Packages: fetched once, cached forever

Tectonic downloads a LaTeX package the first time a document needs it, then caches it locally. That makes the very first compile of a new document type slower (and needs a network connection), and every compile after it fast and offline.

**Offline mode** (Settings, General, or the ⌘K palette) makes this a guarantee: the compiler runs with `--only-cached` and never touches the network. A document needing an uncached package fails fast with a clear error instead of hanging on a download.

## Limits and safety valves

- One compile runs at a time per project; newer requests supersede stale ones, so switching projects mid-build never paints the wrong PDF.
- A hard 300-second timeout kills a wedged build rather than letting it spin forever.

## Common failures, quick fixes

- **"Missing package" in Offline mode**: turn Offline mode off for one compile to fetch and cache it, then turn it back on.
- **Undefined citation or reference warnings**: [Preflight](/Oleafly/preflight/#references--assets) pinpoints every one, with the file and line.
- **An error you can't parse**: ask the AI. "Fix the LaTeX errors" triggers a compile, log read, targeted edit, and recompile loop, with every change shown to you for approval first.

## Beyond Tectonic

Tectonic covers everyday compiling. For tagged, accessible PDFs (Section 508 / PDF-UA), Oleafly can use LuaLaTeX via a system TeX Live or a self-contained TinyTeX install. That story lives on [LaTeX engines & packages](/Oleafly/latex-engines/).
