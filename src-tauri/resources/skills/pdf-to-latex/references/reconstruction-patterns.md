# Reconstruction patterns

What the importer produces for each kind of content, why, and what to build instead.

The importer is deterministic: it reads the PDF text layer, orders items by column, groups
them into lines and paragraphs, classifies headings by font size, and emits LaTeX. It has
no model of tables, citations, equations, or floats.

## Title, authors, abstract

The first level-one heading on page one becomes the document title. Everything else on that
page arrives as ordinary paragraphs.

```latex
\title{Learning to Compress Sensor Streams at the Edge}
\author{A. Mehta \and R. Okonkwo \and J. Lindqvist}
\date{}
\maketitle

\begin{abstract}
...
\end{abstract}
```

Affiliations and emails become paragraphs of their own. Fold them into `\author`, or into
the venue class's own commands once the class is set.

## Headings

The importer maps three font-size tiers onto `\section`, `\subsection`, and
`\subsubsection`, with the title consuming the top tier. Consequences:

| Symptom | Cause | Fix |
|---|---|---|
| A bold lead-in sentence became a `\section` | It was set larger or bolder than body text | Turn it back into `\textbf{...}` inline. |
| Everything is at one level | The document used one heading size with numbering | Read the numbers (`3.1`, `3.1.2`) and rebuild the hierarchy from them. |
| A level is skipped | The middle tier did not appear on the sampled pages | Renumber to contiguous levels. |
| An appendix heading looks like a section | Appendices have the same font | Add `\appendix` before the first one. |

Give every heading a label (`\label{sec:method}`) as you go, so cross references have
something to point at.

## Paragraphs and line breaks

Lines are preserved inside a paragraph, so end-of-line hyphenation survives:

```
we evaluate the represen-
tation on three datasets
```

Rejoin these. Search for a hyphen at end of line followed by a lowercase letter, and check
each hit: a real compound (`self-supervised`) that happens to break at the hyphen must keep
it.

Also watch for:

- Ligature damage: `fi` and `fl` may arrive as a single glyph or as nothing at all.
- Quotation marks flattened to `"`, which LaTeX renders as two right quotes. Convert to
  `` `` `` and `''`.
- Percent signs, ampersands, and underscores. The importer escapes them, so `50\%` is
  correct. Do not double-escape when you retype a line.
- A stray page number or running head that the furniture stripper missed, usually on the
  first and last pages where the header differs.

## Math

Display lines that look like math become `\[ ... \]`. Inline math is guessed. Both are
approximations of a text layer that stores every symbol as a positioned glyph.

| Symptom | Reality | Fix |
|---|---|---|
| Subscripts and superscripts missing | They are separate text items at a different baseline | Retype the expression from the page image. |
| An equation split across two `\[ \]` blocks | The line grouping split it | Merge into one, or into `align` if it was a numbered multi-line equation. |
| Equation numbers as literal `(3)` at the end of the line | The number is body text in the PDF | Delete it, use `equation` with a `\label`, and reference it with `\eqref`. |
| Greek letters as Latin letters, or as nothing | Font encoding in the source PDF | Retype from the image. |
| An integral, sum, or matrix flattened to one line | No structure in the text layer | Rebuild with `\int`, `\sum`, `pmatrix`. |
| Inline math that stayed prose | The heuristic did not fire | Wrap in `$...$`. |

Rebuild math from the page image, not from the extracted text. Extracted math is a hint
about where an equation is, not what it says.

## Tables

There is no table detection. A table arrives as a run of paragraphs with the cells in
reading order, so a three-column table becomes lines of three run-together values.

Rebuild as a float with `booktabs`:

```latex
\begin{table}[t]
  \centering
  \caption{Accuracy on the three held-out splits.}
  \label{tab:results}
  \begin{tabular}{lccc}
    \toprule
    Method & Split A & Split B & Split C \\
    \midrule
    Baseline      & 0.831 & 0.774 & 0.802 \\
    Ours          & 0.849 & 0.803 & 0.821 \\
    \bottomrule
  \end{tabular}
\end{table}
```

- Read the numbers off the page image, cell by cell. This is where transcription errors
  happen, and a wrong number in a results table is the worst possible outcome of this whole
  process.
- Keep the original's significant figures. Do not round, do not reformat.
- Multi-row headers become `\multicolumn` with `\cmidrule`.
- Caption above the table, and add `\label` so the text can reference it.
- A table that spans pages becomes `longtable`. Load `booktabs` and `longtable` in the
  preamble as you introduce them.

## Figures

The importer extracts raster images to `assets/` and emits, after the last paragraph of the
page the image appeared on:

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=\linewidth]{assets/page3-img1.png}
\end{figure}
```

Fix four things:

1. **Position.** Move it to just after the paragraph that first references it.
2. **Caption.** Copy the caption text from the page. It arrived as a paragraph somewhere
   nearby; find it and delete the duplicate.
3. **Label and reference.** `\label{fig:architecture}`, and change the literal "Figure 3"
   in the text to `Figure~\ref{fig:architecture}`.
4. **Width.** `\linewidth` is rarely right. In a two-column layout a single-column figure
   wants `\columnwidth` and a full-width one wants `figure*`.

Vector figures (charts drawn in the PDF rather than embedded as images) are not extracted
at all. They leave a gap, sometimes with their axis labels loose in the text. Note them in
the progress log; redrawing one is a separate job for `oleafly-figure-prep`.

## Lists

Numbered and bulleted lists arrive as paragraphs starting with `1.` or a bullet character.
Rebuild as `enumerate` and `itemize`, and delete the literal markers.

## Footnotes

Footnote text lands at the bottom of its page, in reading order, as a paragraph beginning
with a number or a symbol. The marker in the body is a bare superscript digit that probably
did not survive. Match them up by reading order and rebuild with `\footnote{...}` at the
call site.

## Algorithms and code

A pseudocode block becomes indentation-free paragraphs. Rebuild with `algorithm` plus
`algorithmic`, or `verbatim` for real code. Indentation is gone from the text layer, so
take it from the page image.

## Citations and the reference list

Covered in step 7 of the skill. The importer does nothing with them: in-text citations stay
literal, and the reference list is a plain section.

The one thing to do carefully here is fix the reference list text before looking anything
up, because line joining mangles author lists:

```
[14] R. Okonkwo, A. Mehta, and J. Lind-
qvist. Compressing sensor streams. In
Proc. SenSys, 2024.
```

Rejoin, then look up by DOI or title with `verify_citation`.

## Verification loop

After each section:

1. `compile`.
2. `get_pdf_text` for your rebuild's text, capped at 2000 characters per page. Compare the
   section's numbers, symbols, and headings against the original page.
3. `verify_pdf_pages` when the question is visual (column flow, overfull tables, figure
   placement). It needs the PDF page capture setting and a vision model.
4. Write the result into `import/pdf-progress.md`.

A section is done when its text matches the original and its layout is close enough that
the differences are deliberate.
