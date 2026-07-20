---
title: "Autocomplete & slash commands"
description: "LaTeX command completion with snippet tab-stops, \\ref and \\cite completion from your project, and the Notion-style / insert menu."
---

The editor completes three things as you type: LaTeX commands, cross-references, and citations. Add the `/` slash menu for structure, and most documents can be written without typing boilerplate.

Suggestions appear automatically while typing; **Ctrl+Space** summons them anywhere. Accept with **Tab** or **Enter**.

![The slash insert menu in the editor](/Oleafly/media/editor-slash-menu.png)

## Command completion

Type a backslash and keep going: `\sec…` offers `\section`, `\fra…` offers `\frac`. Around 35 everyday commands are covered, including sectioning (`\section` through `\paragraph`), text formatting (`\textbf`, `\textit`, `\emph`, `\underline`), document structure (`\usepackage`, `\input`, `\maketitle`, `\tableofcontents`), math (`\frac`, `\sqrt`, `\sum`, `\int`), references (`\label`, `\ref`, `\eqref`, `\cite`, `\footnote`), and figures (`\includegraphics`).

Completions insert as snippets with tab-stops: accept `\frac` and you get `\frac{│}{}` with the cursor in the numerator; **Tab** hops to the denominator. Environment completions like `\itemize`, `\enumerate`, `\equation`, and `\align` insert the whole `\begin…\end` block with the cursor inside.

## Reference completion

Inside `\ref{`, `\eqref{`, `\pageref{`, `\autoref{`, `\cref{`, or `\Cref{`, the menu lists every `\label{}` defined in your document. No more scrolling up to remember whether you called it `fig:arch` or `fig:architecture`.

## Citation completion

Inside `\cite{` and its variants (`\citep`, `\citet`, `\citeauthor`, `\citeyear`, `\parencite`, `\textcite`), the menu lists the citation keys from your project's `.bib` files, which are parsed automatically when the project opens.

If the paper isn't in your `.bib` yet, that's what [citation lookup](/Oleafly/citations/) is for: paste a DOI or title and Oleafly adds the entry and the `\cite` in one step.

## The slash menu

Type `/` anywhere and a Notion-style insert menu opens, filtering as you type:

| Command | Inserts |
|---|---|
| `/section`, `/subsection` | Sectioning commands |
| `/itemize` | Bulleted list |
| `/enumerate` | Numbered list |
| `/item` | A list item |
| `/equation` | Display equation environment |
| `/align` | Aligned multi-line equations |
| `/frac` | A fraction |
| `/figure` | A complete figure float with `\includegraphics` and `\caption` |
| `/table` | A table float with a starter `tabular` |
| `/bold`, `/italic` | `\textbf{}`, `\textit{}` |
| `/label` | `\label{}` |
| `/usepackage` | `\usepackage{}` |

Everything inserts as a snippet with tab-stops, so **Tab** walks you through the blanks (caption, then label, then onward).

## Good to know

- **Tab does double duty**: it accepts an open suggestion, otherwise it indents.
- Completion menus close when you click elsewhere; **Esc** dismisses them explicitly.
- File-path completion inside `\input{}` or `\includegraphics{}` isn't there yet; the file tree and the `/figure` snippet are the current route.
