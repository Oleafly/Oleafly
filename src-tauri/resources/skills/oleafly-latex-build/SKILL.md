---
name: Build and fix
description: Drive Oleafly's compile, diagnose, fix loop until the document builds clean. Use when a compile fails, when the log shows undefined control sequence, missing package or file not found, missing $ inserted, runaway argument, undefined citation or reference, a font that will not load, overfull hbox warnings, a bibliography that will not resolve, a Typst error, or when the user says it will not compile, the PDF is stale, or asks why the build is different on another machine.
license: MIT
compatibility: Needs an open Oleafly project on any of the four engines (Tectonic, latexmk, Typst, Markdown). No external tools are required.
allowed-tools: read_file replace_in_file write_file create_file list_files search_project project_map compile get_log get_pdf_text verify_pdf_pages set_main_doc run_command update_todos load_skill read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: tooling
    tools:
      - read_file
      - replace_in_file
      - write_file
      - list_files
      - search_project
      - project_map
      - compile
      - get_log
      - get_pdf_text
      - verify_pdf_pages
      - set_main_doc
      - run_command
      - update_todos
      - read_skill_file
---

# Build and fix

A compile failure is a lookup, not a puzzle. Read the first error, name its class, apply the smallest edit that fixes that class, compile again. Repeat until `compile` returns `success: true` with an empty `errors` list.

## 1. Know the engine before touching anything

`read_file` on `project.json`. The `engine` value decides almost everything below.

| `engine` | What runs | Notes |
|---|---|---|
| `xetex` | Bundled Tectonic sidecar, XeTeX engine | The default. Fetches packages from a pinned TeX Live bundle. `fontspec` works. |
| `latexmk` | The user's system TeX (MacTeX, TeX Live, MiKTeX, TinyTeX) | The underlying engine is pdfLaTeX unless a `% !TeX program =` line, or fontspec / polyglossia / unicode-math, forces XeLaTeX or LuaLaTeX. Shell escape is off unless the user granted it for this project on this machine. |
| `typst` | Pinned Typst CLI | No SyncTeX, no isolated figure compile, no conversion exports. |
| `markdown` | Pandoc, with Tectonic as its PDF engine | Needs Pandoc installed; the app can download it. |

The assistant cannot switch engines. `set_main_doc` changes the engine as a side effect of the file extension, and that is the only lever it has. Anything else is a Settings change the user makes.

Never write `pdflatex` as an engine name. Oleafly does not accept it, and a project or template that declares it disappears from the app.

## 2. Compile and read the result

1. `compile`. The envelope carries `success`, `errors`, `has_pdf`, and `log_tail`.
2. `get_log` for the last 20k characters when `log_tail` is not enough.
3. Read the **first** error, not the last. LaTeX errors cascade, so the tail is usually noise from the first one.
4. Note whether `has_pdf` is true. A PDF plus errors means a recoverable error was stepped over and the output is probably wrong even though a file exists.

## 3. Classify before editing

`read_skill_file` this skill's `references/error-catalog.md` and match the log line to a row. It gives the cause, the fix, and the tool call for each pattern, across LaTeX, BibTeX and Biber, fonts, Typst, and Pandoc.

If nothing matches, say so rather than guessing, and fall back to the bisect procedure at the end of the catalog.

## 4. Fix with the smallest edit

Use `replace_in_file` with enough surrounding text to be unambiguous. Prefer one class of error per round so the next compile tells you whether that fix worked.

Rules that keep the loop honest:

- Never delete content to make a compile pass. Comment nothing out permanently without saying so.
- Never add a package you have not confirmed the engine can resolve.
- Never change the engine, the class, or the bibliography backend to dodge a single error.
- If the fix would change what the document says, stop and ask.

## 5. Recompile until it is actually clean

Clean means `success: true` and `errors: []`. A build that produces a PDF while errors remain is not done.

Then check what came out:

- `get_pdf_text` to confirm the sections, the title, and the references list are present.
- `verify_pdf_pages` when layout matters (column breaks, a table that overflows, a figure that landed on the wrong page). It only exists when the user has enabled PDF page capture in Settings; if it is unavailable, say what you could not check.
- `project_map` for `unresolvedRefs` and `unresolvedCites` after any citation or reference work.

## 6. Sweep for the failures that do not error

`read_skill_file` this skill's `references/engine-notes.md` when any of these apply. They compile successfully and are still wrong:

- the log mentions an absolute path under `/System/Library`, `/Library/Fonts`, or `C:/Windows/Fonts`, which means the build is bound to this machine's fonts;
- the document is CJK and uses `ctex`;
- a font was requested and silently fell back;
- two machines produce visibly different PDFs from the same source;
- the same source compiles here and fails on a coauthor's machine.

## Decision points

| Question | Answer |
|---|---|
| biblatex plus Biber, or natbib plus BibTeX? | On Oleafly's Tectonic both work, because the app ships a pinned `tectonic-biber` and recovers when Tectonic misses it. Outside Oleafly, plain Tectonic and biblatex drift apart by version, so natbib plus BibTeX is the portable choice. Never swap a venue's supplied `.bst` for biblatex. |
| A package is missing from Tectonic's bundle | Say which package and offer the closest bundled alternative. Installing packages needs system TeX, which is the user's engine switch to make, not yours. |
| Overfull box warnings | Not errors. Triage rather than chase: reword first, keep `microtype` loaded, hyphenate one stubborn word, and only then consider local `sloppypar`. Never `\sloppy` globally. |
| The user asks to run latexmk or tectonic by hand | `run_command` can, with approval, but the app's own `compile` uses the project's engine and artifact layout. Prefer `compile`; reach for `run_command` only for something `compile` cannot do, such as inspecting a produced file. |
| Nothing works and the error is opaque | Bisect. See the end of `references/error-catalog.md`. |

## Failure handling

| Problem | What to do |
|---|---|
| The same error survives two fixes | Stop editing. Report the log line, what you tried, and what you think it means. |
| The error names a file that is not in the project | `list_files` and `search_project` before concluding it is missing. Then say whether it must be supplied by the user. |
| Compile times out or is cancelled | Report it as a timeout, not a source error. A first Tectonic build downloads bundle files and is slow. |
| Pandoc is missing on a Markdown project | Tell the user; the app installs it on demand from Settings. |
| Biber or biblatex version skew | The log carries an `[Oleafly]` note that distinguishes Biber not found from a version mismatch. Quote it verbatim. |
| The PDF looks stale | Compile again and compare page count with `get_pdf_text`. Do not delete build directories through `run_command` unless the user asks. |

## Artifacts

A compiled PDF, a clean compile log, and a short written list of what was wrong and what changed. Leave the source in a state where every edit is explainable.

## Done when

- [ ] `compile` returns `success: true` with an empty `errors` list
- [ ] No content was removed to achieve that
- [ ] `project_map` reports no unresolved references or citations, or the remaining ones are listed for the user
- [ ] The output was checked with `get_pdf_text`, and with `verify_pdf_pages` when it was available
- [ ] No absolute host font path appears in the log
- [ ] Every change is named in one line, with the error it fixed
