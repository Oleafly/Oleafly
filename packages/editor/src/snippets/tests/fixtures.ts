const latex = { languages: ["latex"] };

export const SLASH_ENTRIES = {
  "latex.slash.section": {
    ...latex,
    name: "Section",
    nameKey: "latex.snippet.section",
    prefix: "/section",
    body: "\\section{$1}",
    expand: "list",
    where: "text",
    inWord: true,
  },
  "latex.slash.subsection": {
    ...latex,
    name: "Subsection",
    prefix: "/subsection",
    body: "\\subsection{$1}",
    expand: "list",
    where: "text",
    inWord: true,
  },
  "latex.slash.frac": {
    ...latex,
    name: "Fraction",
    prefix: "/frac",
    body: "\\frac{$1}{$2}",
    expand: "list",
    where: "text",
    inWord: true,
  },
};

export const AT_ENTRIES = {
  "at.alpha": { ...latex, name: "alpha", prefix: "@a", body: "\\alpha", expand: "list", where: "math", inWord: true },
  "at.beta": { ...latex, name: "beta", prefix: "@b", body: "\\beta", expand: "list", where: "math", inWord: true },
};

export const PAPER_ENTRIES = {
  "paper.figure": {
    name: "Figure",
    prefix: "fig",
    body: { latex: "\\begin{figure}[${1|htbp,t,b,H|}]\n\t\\caption{${2:Caption}}\n\\end{figure}$0", typst: "#figure()" },
    expand: "tab",
    languages: ["latex", "typst"],
    where: "text",
    lineStart: true,
  },
  "paper.subfigures": {
    ...latex,
    name: "Two subfigures",
    prefix: "figs",
    body: "\\begin{figure}$1\\end{figure}$0",
    expand: "tab",
    where: "text",
    lineStart: true,
  },
  "paper.figref": {
    ...latex,
    name: "Figure reference",
    prefix: "figref",
    body: "Figure~\\ref{fig:$1}$0",
    expand: "list",
    where: "text",
  },
  "paper.theorem": {
    ...latex,
    name: "Theorem",
    prefix: "thm",
    body: "\\begin{theorem}\n\t$1\n\\end{theorem}$0",
    expand: "tab",
    where: "text",
  },
  "paper.table": {
    ...latex,
    name: "Table",
    prefix: "tab",
    body: "\\begin{table}$1\\end{table}$0",
    expand: "tab",
    where: "text",
    lineStart: true,
  },
};

export const FAST_MATH_ENTRIES = {
  "math.frac": { ...latex, name: "Fraction", prefix: "//", body: "\\frac{$1}{$2}$0", expand: "auto", where: "math", inWord: true },
  "math.mk": { ...latex, name: "Inline math", prefix: "mk", body: "\\$$1\\$$0", expand: "auto", where: "text" },
  "math.subscript": {
    ...latex,
    name: "Subscript",
    prefix: "re:(?<![\\\\A-Za-z])([A-Za-z])(\\d)",
    body: "[[0]]_[[1]]",
    expand: "auto",
    where: "math",
    inWord: true,
  },
  "math.squared": { ...latex, name: "Squared", prefix: "sr", body: "^2", expand: "auto", where: "math", inWord: true },
  "math.infinity": { ...latex, name: "Infinity", prefix: "ooo", body: "\\infty", expand: "auto", where: "math", inWord: true },
  "math.sum": {
    ...latex,
    name: "Sum",
    prefix: "sum",
    body: "\\sum_{${1:i=1}}^{${2:n}} $0",
    expand: "auto",
    where: "math",
  },
  "math.brace": {
    ...latex,
    name: "Braces",
    prefix: "lr{",
    body: "\\left\\{ $1 \\right.$0",
    expand: "auto",
    where: "math",
    inWord: true,
  },
};
