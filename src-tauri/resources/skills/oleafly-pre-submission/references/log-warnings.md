# Log warnings that matter

`get_log` returns the tail of the last compile log. Most of it is noise. These are the lines worth finding, what each one means, and whether it blocks a submission.

## Blocking

| Log text | Meaning | Fix |
| --- | --- | --- |
| `LaTeX Warning: Reference ... undefined` | A `\ref` or `\autoref` points at a label that does not exist. The PDF prints `??`. | Fix the label, or recompile if the label was just added. Two passes are needed after adding a label. |
| `LaTeX Warning: Citation ... undefined` | A `\cite` key is not in the bibliography. The PDF prints `[?]`. | Add the entry, or fix the key. Rerun the bibliography step. |
| `LaTeX Warning: There were undefined references` | Summary line for the two above. | Same. |
| `LaTeX Warning: Label ... multiply defined` | Two `\label` commands share a name. Every `\ref` to it resolves to the last one. | Rename one. |
| `Missing character: There is no ... in font` | A character in the source has no glyph in the current font. It silently disappears from the PDF. | Change the font, or replace the character. Common with typographic quotes, arrows, and non-Latin text. |
| `Package biblatex Warning: File '....bbl' is wrong format version` | The `.bbl` was built by a different `biblatex` version. | Rebuild the bibliography with the matching version. Critical for arXiv. |
| `! LaTeX Error:` or any line starting with `!` | A real error. The PDF is either missing or wrong. | Fix before anything else. |

## Worth checking

| Log text | Meaning | When it matters |
| --- | --- | --- |
| `Overfull \hbox (Npt too wide)` | A line sticks out past the text block. | Under 5pt is usually invisible. Over 10pt is visible in print and looks careless. Over 30pt means something is genuinely broken, usually a long URL, a wide table, or a `verbatim` block. |
| `Underfull \vbox` / `Underfull \hbox (badness 10000)` | Stretched spacing. | Cosmetic, except on a page where it opens a large gap. |
| `LaTeX Warning: Float too large for page` | A figure or table does not fit. | It will be placed somewhere unexpected or pushed to the end. |
| `LaTeX Font Warning: Font shape ... not available` | A requested weight or shape does not exist and a substitute was used. | Check the substitute looks right. |
| `Package hyperref Warning: Token not allowed in a PDF string` | A macro appears in a section title or a caption that hyperref puts into a bookmark. | Cosmetic in the PDF, ugly in the bookmark pane. Wrap it in `\texorpdfstring`. |
| `LaTeX Warning: Label(s) may have changed. Rerun` | Cross-references are one pass out of date. | Recompile. If it persists across several compiles, something is unstable, usually a page-number-dependent reference. |
| `No file ....bbl` | The bibliography was never built. | Blocking if the paper cites anything. |
| `Package caption Warning: Unsupported document class` | The caption package does not know the venue class. | Check the captions render the way the venue expects. |

## Not worth acting on

- `Package hyperref Warning: Ignoring empty anchor`
- `pdfTeX warning: ... has been already used`
- Font substitution notices for a shape the document does not actually use
- `Overfull \hbox` under 5pt
- Package version notices and load-order info lines

## How to scan

Read the log tail, then confirm with the structured data. `project_map` gives you `unresolvedRefs` and `unresolvedCites` directly, which is more reliable than grepping a truncated log. Use the log for font, box, and float problems, which `project_map` does not know about.

If the log is truncated before the part you need, recompile and read it again immediately, or search the source for the construct named in the last visible message.
