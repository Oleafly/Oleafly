# What each importer leaves behind

Three importers feed LaTeX projects in Oleafly:

| Source | How | Where it lands |
|---|---|---|
| `.docx` | pandoc `--from=docx --to=latex --standalone --extract-media=assets` | `main.tex` plus `assets/` |
| `.md` | pandoc `--from=markdown --to=latex --standalone` | `main.tex` |
| `.pdf` | the built-in converter in the app, no pandoc | `main.tex` plus `assets/*.png` |

Pandoc is pinned at 3.9. Older projects may carry the output of an earlier pandoc, so
check what is actually in the file rather than assuming the version.

## The pandoc standalone preamble, block by block

| Block | What it is | Verdict |
|---|---|---|
| `\usepackage{iftex}` with `\ifPDFTeX ... \else ... \fi` | Loads `inputenc`, `fontenc`, `textcomp` for pdfTeX, `fontspec` and `unicode-math` otherwise | Collapse. Oleafly compiles with a Unicode engine, so keep only the `fontspec` side. |
| `\usepackage{lmodern}` | Latin Modern for pdfTeX | Drop. It has no effect under `fontspec`. |
| `\IfFileExists{microtype.sty}{...}` plus `\UseMicrotypeSet[protrusion]{basicmath}` | Micro typography | Keep the plain `\usepackage{microtype}` if the venue allows it, drop the guard. |
| `\usepackage{xurl}` | Line breaks in URLs | Keep if the document has URLs, otherwise drop. |
| `\IfFileExists{bookmark}{...}{\usepackage{hyperref}}` | PDF bookmarks | Replace with one plain `\usepackage{hyperref}` at the end of the preamble. |
| `\hypersetup{hidelinks, pdfcreator={LaTeX via pandoc}}` | Link styling and metadata | Keep `hidelinks` if you want unboxed links. Always delete `pdfcreator`. |
| `\urlstyle{same}` | URLs in body font | Harmless. Keep or drop. |
| `\usepackage{longtable,booktabs,array}` | Table support | Keep. Add `\usepackage{calc}` only if `\real{}` widths survive step 5. |
| `\usepackage{graphicx}` with `\makeatletter \def\maxwidth ... \setkeys{Gin}{...}` | Caps image size at the text width | Keep `graphicx`. The `\maxwidth` machinery can go once figures have explicit widths. |
| `\newcommand{\pandocbounded}[1]{#1}` (pandoc 3.6 and later) | Wrapper around every image | Keep the definition, or delete it and every `\pandocbounded{...}` wrapper in the same edit. |
| `\setlength{\emergencystretch}{3em}` | Prevents overfull lines | Keep. It is doing real work on imported prose. |
| `\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}` | Used by every pandoc list | Keep unless you rewrite the lists. `search_project` for `tightlist` before deleting. |
| `\setcounter{secnumdepth}{-\maxdimen}` | Turns off all section numbering | Delete unless the user wants unnumbered sections. This is the single most common unwanted import artifact. |
| `\usepackage{selnolig}` guarded by `\ifLuaTeX` | Ligature suppression | Drop. It is LuaTeX only. |
| `\usepackage[normalem]{ulem}` | Strikeout from tracked changes | Keep only if `\sout` appears in the body. |
| `\newlength{\cslhangindent}` plus `\newenvironment{CSLReferences}` | citeproc reference list | Drop once step 8 has replaced the list with a real bibliography. |
| `\usepackage{fancyvrb}`, `\DefineVerbatimEnvironment{Highlighting}`, `\newenvironment{Shaded}`, the `\newcommand{\KeywordTok}` family | Syntax highlighting for fenced code (Markdown imports) | Keep the whole block if the document has highlighted code. Drop the whole block if it does not. Never keep half of it. |
| `\title{}`, `\author{}`, `\date{}` empty, with no `\maketitle` | The source had no metadata | Fill them in or delete all four lines. |

## Body patterns

### Headings

```latex
\hypertarget{methods}{%
\section{Methods}\label{methods}}
```

becomes

```latex
\section{Methods}\label{sec:methods}
```

Before renaming the label, `search_project` for `methods` and update every `\ref`,
`\autoref`, and `\hyperref` that used the pandoc slug. Pandoc slugs are lowercase, hyphen
separated, and derived from the heading text, so two identically named headings get
`methods` and `methods-1`.

### Lists

```latex
\begin{itemize}
\tightlist
\item First
\end{itemize}
```

`\tightlist` is fine. Leave it. Removing it from some lists and not others gives the
document two different list spacings.

### Tables

Pandoc output, for any table at all:

```latex
\begin{longtable}[]{@{}
  >{\raggedright\arraybackslash}p{(\linewidth - 4\tabcolsep) * \real{0.33}}
  >{\raggedright\arraybackslash}p{(\linewidth - 4\tabcolsep) * \real{0.33}}@{}}
\toprule\noalign{}
Condition & Accuracy \\
\midrule\noalign{}
\endfirsthead
...
\end{longtable}
```

For a table that fits on one page:

```latex
\begin{table}[htbp]
  \centering
  \caption{Accuracy by condition.}
  \label{tab:accuracy}
  \begin{tabular}{lr}
    \toprule
    Condition & Accuracy \\
    \midrule
    Baseline & 0.83 \\
    Wider context & 0.84 \\
    \bottomrule
  \end{tabular}
\end{table}
```

Keep `longtable` only when the table really spans pages. A `longtable` is not a float, so
it cannot be placed by LaTeX and `\caption` inside it behaves differently.

### Images

```latex
\pandocbounded{\includegraphics[keepaspectratio]{assets/media/image3.png}}
```

becomes

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\linewidth]{assets/architecture.png}
  \caption{System architecture.}
  \label{fig:architecture}
\end{figure}
```

Check the real path with `list_files` first. Pandoc's `--extract-media=assets` keeps the
archive's internal folder, so files usually land at `assets/media/imageN.png`, not
`assets/imageN.png`.

### Math from Word

| Pattern | Fix |
|---|---|
| `\ensuremath{...}` around already-math content | Remove the wrapper. |
| `\text{x}` around a single variable | Remove, it should be math italic. |
| `\hspace{0pt}` scattered through a formula | Remove. |
| `$$ ... $$` | `\[ ... \]`, or `equation` when it needs a number. |
| Missing subscripts or superscripts | Compare against the source. An extractor drops these silently and the result is still valid LaTeX. |
| An equation that arrived as an image | Retype it as math. Note it in `import/notes.md` if you cannot read it. |

### Citations

Word and Markdown imports carry citations as literal text.

| In the file | Means |
|---|---|
| `(Smith and Chen, 2020)` | Author and year style, from a reference manager's plain-text output |
| `[14]` | Numeric style, and the reference list at the end is the key |
| `\autocite{...}` or `\cite{...}` already present | The source was LaTeX. Check the `.bib` exists before touching anything. |
| A `CSLReferences` environment | pandoc-citeproc already rendered a formatted list. The keys are gone; the formatted entries are your lookup source. |

The lookup and verification belong to `oleafly-literature-sweep`. Give it the reference
list text; it comes back with verified entries.

## The PDF converter's output

The built-in converter is deterministic and local. It reads the PDF text layer, orders it
by column, joins lines into paragraphs, guesses headings from font size, and emits this
preamble and nothing else:

```latex
\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}
\setlength{\parskip}{0.5em}
\setlength{\parindent}{0pt}
```

Known consequences:

| Artifact | Why | Fix |
|---|---|---|
| `inputenc` and `fontenc` under a Unicode engine | The preamble is engine agnostic | Drop both lines. `inputenc` is a no-op and `T1` fontenc pulls in bitmap-era encodings. |
| Words split across lines as `represen-` then `tation` | Line breaks are preserved and the PDF hyphenated | Rejoin. Search for a hyphen at end of line followed by a lowercase letter. |
| Headings at the wrong level, or body text promoted to a heading | Levels come from font size | Fix against the original with `get_pdf_text`. |
| Two-column text interleaved | Column detection failed on that page | Set the column mode on re-import, or reorder by hand. |
| Tables as run-together paragraphs | There is no table detection | Rebuild as `tabular` against the original page. |
| Figures at the end of a page with no caption | Figures are emitted after the last paragraph of their page | Move them to their reference point and add the caption from the original. |
| Citations as literal `[12]` and a plain reference section | No bibliography handling | Step 8 of the skill. |
| A page with nothing on it | No text layer (a scan or an image-only page) | Note it. Nothing can be recovered without OCR, which the app does not do. |
| Missing subscripts, superscripts, and symbols in math | The text layer positions them separately | Retype against the page. |

For a PDF import, structure work belongs to `pdf-to-latex`. Use this document for the
preamble and for the shared body patterns.
