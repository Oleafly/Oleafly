# TikZ recipes

Small, Tectonic-safe starting points. Every one of these uses libraries that are in the bundled TeX Live distribution.

## Boxes and arrows

Libraries: `arrows.meta`, `positioning`, `fit`, `backgrounds`.

```latex
\begin{tikzpicture}[
  node distance=8mm and 12mm,
  box/.style={draw, rounded corners=2pt, minimum height=8mm, minimum width=20mm, align=center, font=\small},
  arrow/.style={-{Stealth[length=2mm]}, thick},
]
  \node[box] (input) {Input};
  \node[box, right=of input] (encoder) {Encoder};
  \node[box, right=of encoder] (fusion) {Fusion};
  \node[box, right=of fusion] (head) {Head};
  \draw[arrow] (input) -- (encoder);
  \draw[arrow] (encoder) -- (fusion);
  \draw[arrow] (fusion) -- (head);
\end{tikzpicture}
```

Use `positioning` (`right=of x`) rather than absolute coordinates. A diagram built from relative placement survives an edit; one built from hand-tuned coordinates does not.

## Grouping

```latex
\begin{scope}[on background layer]
  \node[draw, dashed, inner sep=3mm, fit=(encoder)(fusion)] (group) {};
\end{scope}
\node[above=1mm of group, font=\footnotesize] {Shared trunk};
```

`fit` needs the `fit` library, and the background layer needs `backgrounds`.

## A plot drawn in LaTeX

Package: `pgfplots`. Always pin the compatibility level, or the output changes when the package updates.

```latex
\begin{tikzpicture}
  \begin{axis}[
    width=\linewidth, height=5cm,
    xlabel={Time (hours)}, ylabel={Response (unit)},
    legend style={draw=none, font=\small},
    tick label style={font=\small},
    grid=major, grid style={gray!25},
  ]
    \addplot[mark=o, thick] table[x=t, y=a] {data/series.dat};
    \addplot[mark=square, thick, dashed] table[x=t, y=b] {data/series.dat};
    \legend{Baseline, This work}
  \end{axis}
\end{tikzpicture}
```

with `\usepgfplotslibrary{groupplots}` and `\pgfplotsset{compat=1.18}` in the preamble.

pgfplots is the right choice when the data is small and lives in the repository, and when you want the figure's type to match the document exactly. matplotlib is the right choice when the data is large, needs real computation, or the plot type is beyond what pgfplots does comfortably.

## Colors

Load `xcolor` before any color expression is used. Colors that read well and survive grayscale:

```latex
\definecolor{obBlue}{HTML}{0072B2}
\definecolor{obOrange}{HTML}{D55E00}
\definecolor{obGreen}{HTML}{009E73}
\definecolor{obPurple}{HTML}{CC79A7}
```

Never encode a distinction by color alone. Pair each color with a dash pattern, a marker, or a direct label.

## Sizing

A tikzpicture inside a `figure` obeys `\linewidth` only if you make it. Two ways:

- Set explicit widths on the axis or the nodes, as above.
- Wrap in `\resizebox{\linewidth}{!}{...}` as a last resort. It scales the text too, which breaks font size parity with the body, so use it only for a diagram with no small labels.

## Preview loop notes

`preview_figure` compiles the body inside a standalone document. That means:

- Macros defined in the manuscript preamble do not exist there. Inline them, or add the packages that define them through the `packages` argument.
- `\linewidth` in the standalone is not the manuscript's `\linewidth`. A figure that looks balanced in preview can be too wide on the page. Check the compiled document.
- Errors come back with the same messages as any LaTeX compile, so `oleafly-latex-build`'s error catalog applies unchanged.

## What not to draw in TikZ

- Anything with more than a few dozen data points. Use pgfplots with an external table, or matplotlib.
- Photographs, screenshots, or rendered output. Include those as images.
- A concept diagram whose layout you cannot describe precisely. Sketch it with the user first, in words, then draw.
