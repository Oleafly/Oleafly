---
name: PDF to LaTeX
description: Finish rebuilding a PDF as an editable LaTeX project after the app's importer has made its first pass. Reconstructs sectioning, math, tables, figures, and the bibliography one section at a time, verifying each against the original and keeping a progress log so the work survives across chats.
license: MIT
compatibility: For LaTeX projects created by the app's PDF importer. Layout checks need a vision model and the PDF page capture setting. The original PDF must be attached, or a text extractor on PATH.
allowed-tools: read_file, search_project, list_files, project_map, replace_in_file, write_file, create_file, rename_file, compile, get_log, get_pdf_text, verify_pdf_pages, run_command, verify_citation, literature_search, update_todos, load_skill, read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: tooling
    tools:
      - read_file
      - search_project
      - list_files
      - project_map
      - replace_in_file
      - write_file
      - create_file
      - rename_file
      - compile
      - get_log
      - get_pdf_text
      - verify_pdf_pages
      - run_command
      - verify_citation
      - update_todos
      - load_skill
      - read_skill_file
---

# PDF to LaTeX

The app's PDF importer has already run. It read the text layer, ordered it by column,
joined lines into paragraphs, guessed headings from font size, pulled the images out into
`assets/`, and wrote `main.tex`. What it cannot do is understand the document: it has no
tables, no citations, no equation structure, and no idea which heading is which level.

That is the job here. Rebuild the document section by section, verify each section against
the original, and never write anything the original does not contain.

**The one rule.** Everything in the rebuild has to be visible in the original. A plausible
sentence, a rounded number, a guessed citation, an invented table cell: all of these are
worse than a gap marked `TODO`. When you cannot read something, say so in the progress log.

## 1. Situate yourself

1. `list_files` to see what the importer produced: `main.tex`, `assets/*.png`, and possibly
   nothing else.
2. `read_file` the first eighty lines of `main.tex`. The importer's preamble is a short
   fixed block (`article`, `inputenc`, `fontenc`, `geometry`, `amsmath`, `graphicx`,
   `hyperref`). If you see pandoc markers instead, this is a Word or Markdown import: use
   `import-refine`.
3. `compile`. The importer's output normally builds. If it does not, fix the build first
   (`load_skill("oleafly-latex-build")` for the error catalog) before any reconstruction.
4. Read `import/pdf-progress.md` if it exists. Somebody, possibly you in an earlier chat,
   already did part of this. Resume from the first section not marked done.

## 2. Get ground truth for the original

You cannot rebuild what you cannot see. `get_pdf_text` reads the project's **compiled**
PDF, which is your rebuild, not the source. Establish the original separately, in this
order:

1. **Page images in the conversation.** When the user came through "Refine with AI" in the
   import dialog, the first pages of the original are already attached as images. Those are
   ground truth. Check what you actually have before assuming a page is covered.
2. **Ask for the pages you need.** Name the page numbers. "Attach pages 6 to 9 and I will
   rebuild the results section" is a fair request and much better than guessing.
3. **A text extractor, only if the original PDF is inside the project.** Check first, never
   install anything:
   ```sh
   command -v pdftotext || echo missing
   ```
   If it is there: `pdftotext -layout -f 6 -l 6 source.pdf -` gives page 6 with the column
   layout preserved. If it is missing, say so and go back to route 2.

Record which route you used at the top of the progress log. A rebuild done from memory of
an earlier turn is not a rebuild.

## 3. Open the progress log

Create `import/pdf-progress.md` before the first edit, from the template in
`references/progress-log.md`. One row per section: page range, status, what is left.

Update it after every section, in the same turn as the edit. This is what makes the work
resumable, and a long document will not finish in one conversation. Mirror the same rows
into `update_todos` for the current session.

## 4. Fix the skeleton first

One pass over the whole document before any detailed work.

1. `project_map` for the current heading tree, or `search_project` for `\section` and
   `\subsection` if the engine does not offer the index.
2. Compare against the original's structure. Fix, in this order: the title and authors,
   the abstract (it usually arrives as an ordinary paragraph and should be an `abstract`
   environment), then heading levels top to bottom.
3. Delete the surviving page furniture: page numbers, running heads, the venue footer that
   the stripper missed, and the "Preprint. Under review." banner.
4. Rejoin words split across line breaks. Search for a hyphen followed by a newline and a
   lowercase letter. This is mechanical and worth doing in one edit.
5. `compile`.

Do not fix math, tables, or citations yet. The skeleton pass is what makes the rest
navigable.

## 5. Rebuild section by section

For each section, in document order:

1. **Read the original.** The attached page image, or the extracted page text.
2. **Read the current source.** `search_project` for the section heading, then `read_file`
   with an offset around it.
3. **List the differences** before editing: missing equations, a table rendered as
   paragraphs, a figure in the wrong place, a lost footnote, mangled symbols.
4. **Edit.** `replace_in_file` for surgical changes, `write_file` only when a whole section
   is being replaced. The recipes for each kind of content are in
   `references/reconstruction-patterns.md`.
5. **Compile.** If it breaks, fix it now. Never carry a broken build into the next section.
6. **Verify.** See step 6.
7. **Update `import/pdf-progress.md`.**

One section per turn is a reasonable pace. Say which section you are on.

## 6. Verify each section

Two checks, both against the original:

**Text.** `get_pdf_text` returns your compiled PDF page by page, capped at 2000 characters
per page and 20000 characters overall. That cap means it is a section-level check, not a
whole-document one. Compare the section you just rebuilt: are the headings, numbers, and
symbols the same as the original page? A number that differs is a transcription error, and
it matters more than any formatting issue on the page.

**Layout.** `verify_pdf_pages` rasterises up to six pages of your compiled PDF for a vision
model. Use it when the question is visual: does the two-column flow match, did a table
overflow the margin, did a figure land on the right page. It needs the "Allow PDF page
capture for AI" setting and a model that can see images; when either is missing, the tool
says so. Then fall back to the text check and tell the user which pages you could not
inspect visually.

Do not verify by re-reading your own source. It will always agree with itself.

## 7. Bibliography

The reference list arrives as a plain section of paragraphs at the end, and every in-text
citation is literal text (`[14]`, `(Smith and Chen, 2020)`).

1. Rebuild the reference list text accurately first. It is your only lookup key, so fix its
   line breaks and check the author lists against the original page.
2. For each reference with a visible DOI or arXiv id, call `verify_citation` with that
   identifier. It returns canonical BibTeX. Use the returned entry, not the text you read
   off the page.
3. For references without an identifier, hand the list to `oleafly-literature-sweep`. It
   searches and verifies. Do not write a BibTeX entry from the rendered text alone: an
   extractor drops initials and merges authors, and a wrong entry is a wrong citation.
4. Write the verified entries into `references.bib`, replace each literal citation with
   `\cite{key}`, add the bibliography commands, and delete the plain reference section.
5. Compile twice, then check `project_map` for unresolved citation keys.

If an entry cannot be verified, leave the literal text in place and list it in the progress
log under "unresolved". Do not invent a key to make the build quiet.

## 8. Finish the preamble

Once the content is right, hand the preamble to `import-refine` step 3. The importer's
preamble is engine agnostic and carries `inputenc` and `T1` `fontenc` that Oleafly's
Unicode engine does not want, and by now the document needs `booktabs`, `amsmath` extras,
and the bibliography packages that the reconstruction introduced.

## 9. Failure handling

| What you hit | What to do |
|---|---|
| A page with no text and no attached image | Nothing can be recovered. Mark the page `blocked` in the progress log with the reason, and move on. Do not write plausible content. |
| A scanned document (no text layer anywhere) | Say so immediately. The app does not do OCR. Rebuilding from page images alone is possible but slow, so ask the user whether it is worth it before starting. |
| Two-column text interleaved on a page | The column split failed there. Reorder by hand against the original, or ask the user to re-import that page range with the column setting forced. |
| A formula you cannot read at the attached resolution | Ask for a higher resolution crop of that region. Do not approximate an equation. |
| The build breaks and stays broken after three attempts | Stop, revert to the last compiling state, write what failed into the progress log, and report it. |
| The document is over about thirty pages | Agree a page range with the user for this session and log the rest as not started. |

## Artifacts

| Path | What goes in it |
|---|---|
| `import/pdf-progress.md` | Section table with status, the ground-truth route, unresolved items. |
| `main.tex` (or the project's main document) | The rebuild. |
| `references.bib` | Verified entries only. |
| `assets/` | Extracted figures, renamed from `imageN.png` to something meaningful. |

## Done when

- Every section in `import/pdf-progress.md` is `done` or `blocked` with a stated reason.
- The project compiles with no errors.
- Every heading level, equation, table, and figure has been checked against the original,
  and the check is recorded.
- Every citation is either a verified `\cite` key or listed as unresolved.
- Nothing in the document is content you could not see in the original.

## References

- `references/reconstruction-patterns.md`: the rebuild recipe for each kind of content, and
  what the importer gets wrong about it.
- `references/progress-log.md`: the progress log template and how to resume from one.

Read them with `read_skill_file("pdf-to-latex", "references/reconstruction-patterns.md")`.
