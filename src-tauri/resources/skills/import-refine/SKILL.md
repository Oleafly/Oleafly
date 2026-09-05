---
name: Import refine
description: Turn a document Oleafly imported from Word, Markdown, or PDF into a project that compiles cleanly and reads like it was written here. Use after any import, or when a project is full of pandoc leftovers, longtable wrappers, hypertarget blocks, broken math, or citations that arrived as plain text.
license: MIT
compatibility: Works on LaTeX projects created by the Word, Markdown, and PDF importers. Needs a working compile (Tectonic or latexmk). Nothing external.
allowed-tools: read_file, search_project, project_map, list_files, replace_in_file, write_file, create_file, compile, get_log, get_pdf_text, verify_pdf_pages, update_todos, load_skill, read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: tooling
    tools:
      - read_file
      - search_project
      - project_map
      - list_files
      - replace_in_file
      - write_file
      - create_file
      - compile
      - get_log
      - get_pdf_text
      - update_todos
      - load_skill
      - read_skill_file
---

# Import refine

An imported project is a machine's guess at the original. It usually compiles, or almost
compiles, and it carries a specific set of scars depending on which importer made it. This
skill removes the scars in an order that keeps the document building the whole way.

Two rules hold throughout:

- **Compile after every change.** One edit, one `compile`. When a change breaks the build,
  you know exactly which one.
- **Never delete content you cannot explain.** If something looks wrong but you do not know
  what it was, it goes in `import/notes.md`, not in the bin.

## 1. Work out what you are looking at

`list_files` and `read_file` on the main document's preamble tell you the source:

| Signal in the preamble | Importer |
|---|---|
| `pdfcreator={LaTeX via pandoc}`, `\providecommand{\tightlist}`, `\hypertarget` around headings | Word (docx) through pandoc |
| The same pandoc markers, plus `Shaded` and `Highlighting` environments | Markdown through pandoc |
| `\documentclass[11pt]{article}` with `inputenc`, `geometry`, `parskip 0.5em`, `\parindent 0pt` and nothing else | The built-in PDF converter |

If it is the PDF converter, stop here and use `pdf-to-latex` instead. That skill rebuilds
structure against the original pages; this one cleans up a document that already has its
structure. Come back here afterwards for the preamble pass.

Start a checklist with `update_todos` covering steps 2 to 9. An import cleanup is long and
gets interrupted.

## 2. Compile first, and classify what breaks

Run `compile` before editing anything. Then:

- **It builds.** Good. The work is quality, not repair. Go to step 3.
- **It fails.** Read `get_log`. Classify the first real error (the first `!` line, not the
  warnings after it) and fix only that one, then compile again. For the error catalog and
  the log reading order, `load_skill("oleafly-latex-build")`; it owns the LaTeX error
  taxonomy and the rerun rules. Come back here once the build is green.
- **It fails on a missing package.** Imports frequently pull in packages the engine does
  not have. Check `references/import-artifacts.md` first: most of them (`lmodern`,
  `selnolig`, `microtype`, `xurl`) can simply be dropped rather than installed.

Do not start the preamble pass on a broken build. You will not be able to tell your
breakage from the import's.

## 3. Normalise the preamble

The pandoc standalone preamble is roughly forty lines of defensive boilerplate. Most of it
is dead weight in an Oleafly project, and some of it actively fights the document.

Work through `references/import-artifacts.md`, which lists each block, what it does, and
whether to keep it. The three that matter most:

1. `\setcounter{secnumdepth}{-\maxdimen}` turns off all section numbering. Word documents
   almost always want numbering back. Delete the line unless the user asked for unnumbered
   sections.
2. The `iftex` / `ifPDFTeX` branch with `inputenc`, `fontenc`, `textcomp`, and `lmodern`.
   Oleafly compiles with a Unicode engine, so the pdfTeX branch never runs and the XeTeX
   branch just loads `fontspec` and `unicode-math`. Collapse it to the two lines you
   actually need.
3. Duplicate package loads after a merge (`amsmath` twice, `graphicx` twice). Consolidate
   into one block, alphabetical, one package per line, so the next person can read it.

Order the surviving preamble: document class, then geometry and fonts, then math, then
graphics and tables, then bibliography, then `hyperref` (which goes last), then the
document's own macros. Compile.

Keep every macro the document body actually uses. Before deleting a `\newcommand` or a
`\providecommand`, `search_project` for its name. `\tightlist` in particular is used by
every pandoc list, so it stays unless you also rewrite the lists.

## 4. Fix the sectioning

Pandoc wraps every heading:

```latex
\hypertarget{results}{%
\section{Results}\label{results}}
```

That works but it is unreadable and it breaks as soon as anyone edits the title. Replace
each one with a plain `\section{Results}\label{sec:results}`. Keep a label on every
heading, because cross references may point at the pandoc slug; when you rename a label,
`search_project` for the old slug and fix every `\ref` and `\autoref` in the same edit.

Then check the hierarchy with `project_map`: a Word document often starts at
`\subsection` because its top level was the title, or jumps from `\section` to
`\subsubsection`. Promote or demote so the levels are contiguous. Compile.

## 5. Tables

Pandoc renders every table as a `longtable`, even a three-row one, with a column spec
built out of `\real{}` fractions of `\columnwidth`.

- A table that fits on a page becomes a `tabular` inside a `table` float, with a caption
  and a label. Small tables in a `longtable` float badly and cannot be referenced.
- A table that genuinely runs over a page stays a `longtable`. Keep its `\endfirsthead` and
  `\endhead` blocks.
- Either way, use `booktabs` rules (`\toprule`, `\midrule`, `\bottomrule`) and drop the
  vertical bars pandoc did not emit anyway.
- Convert the `\real{}` column widths to plain `p{}` or `l c r` unless the widths were
  doing real work.

One table per edit, compile after each. `references/import-artifacts.md` has the before and
after.

## 6. Images

Find them all with `search_project` for `includegraphics`.

- The Word importer extracts media into `assets/` (usually `assets/media/imageN.png`).
  Confirm the real path with `list_files` before you change anything: a wrong path is a
  missing file error, not a warning.
- Newer pandoc wraps images in `\pandocbounded{...}`. That macro is defined in the pandoc
  preamble; if you removed the definition, remove the wrapper too, in the same edit.
- Give each image a `figure` float, a caption, and a `\label{fig:...}`, unless it is truly
  inline. Then reference it from the text.
- `imageN.png` is not a name. Rename the files to something meaningful with `rename_file`
  and update the paths, or record in `import/notes.md` that they need names.

Compile and look at the result. `verify_pdf_pages` (if PDF page capture is on) or
`get_pdf_text` will tell you whether a figure landed where you expect.

## 7. Math

Word math survives conversion better than PDF math, but both need a pass.

- Search for `\ensuremath`, stray `\text{}` wrappers around single letters, and
  `\hspace{0pt}` fillers. Remove them.
- `$$ ... $$` becomes `\[ ... \]`, or an `equation` environment when the equation needs a
  number and a label.
- Check every displayed equation against the source document. Subscripts and superscripts
  are the first thing an extractor loses, and a wrong subscript reads as correct LaTeX.
- Align multi-line equations with `align` rather than stacked `\[ \]` blocks.

## 8. Citations

An imported document has citations as literal text: `(Smith and Chen, 2020)` or `[14]`.
There is no `.bib` file and no `\cite`.

1. `search_project` for the citation patterns and list what is there.
2. If the original had a reference list, it is now a plain section at the end. That list is
   your source of truth for what to look up.
3. Hand the actual work to `oleafly-literature-sweep`: it searches, verifies each DOI with
   `verify_citation`, and writes the `.bib` entries. Do not write BibTeX from the text of
   the reference list alone. A mangled author list becomes a wrong citation, and a citation
   you cannot verify does not go in the file.
4. Once entries exist, replace each literal citation with `\cite{key}` and delete the plain
   reference section in favour of `\printbibliography` or `\bibliography{...}`.
5. Compile twice and check `project_map` for unresolved citations.

If the user does not want the bibliography rebuilt now, leave the literal citations alone
and write the count into `import/notes.md`. Half-converted citations are worse than none.

## 9. Record what was lost

Create `import/notes.md` and keep it current as you go. It is the deliverable the user
reads, not a scratch file. For each item: where it was, what it looks like now, and what
you would need to fix it.

Things that belong in it:

- Content the importer dropped: text boxes, headers and footers, comments, tracked
  changes, equations that arrived as images, anything under a "no text layer" note.
- Formatting that has no LaTeX equivalent and was approximated.
- Tables or figures you flagged but did not convert.
- Citation counts: how many literal citations remain, how many were resolved.
- Anything you deliberately left alone and why.

## 10. Failure handling

| What happens | What to do |
|---|---|
| A fix breaks the build | Revert that one edit, compile to confirm green, then try a smaller version of the fix. |
| The same error survives three attempts | Stop editing. Write the error, the file, the line, and what you tried into `import/notes.md` and tell the user. |
| A package is missing and cannot be dropped | Say so plainly. Do not silently remove the feature that needed it. |
| Output is garbled but the build is green | Compare against the source with `get_pdf_text`, or `verify_pdf_pages` for layout. Encoding damage is invisible in the log. |
| The document is enormous | Do one section per turn, keep the checklist in `update_todos`, and compile between sections. |

## Artifacts

| Path | What goes in it |
|---|---|
| `import/notes.md` | Lost content, approximations, and open decisions. |
| `references.bib` (or the project's existing `.bib`) | Entries recovered in step 8. |
| `assets/` | Extracted media, renamed. |

## Done when

- The project compiles with no errors.
- The preamble is one readable block with nothing in it the document does not use.
- Headings are plain sectioning commands with labels, and the levels are contiguous.
- Every table is either a captioned `tabular` or a deliberate `longtable`.
- Every figure has a caption, a label, and a path that resolves.
- Citations are either real `\cite` keys with verified entries, or literal text with a
  count in `import/notes.md`.
- `import/notes.md` exists and says what a human still needs to decide.

## References

- `references/import-artifacts.md`: what each importer produces and the exact fix, with
  before and after.

Read it with `read_skill_file("import-refine", "references/import-artifacts.md")`.
