import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLatexInsights, missingLatexSources } from "./latex-insights";

const MAIN = String.raw`\documentclass{article}
\usepackage{todonotes}
\newcommand{\tool}{Foundry}
\newtheorem{lemma}{Lemma}
\title[Short]{Creep in \textbf{Niobium}\\ Alloys}
\author{Elin Hagstrom\thanks{Corresponding author.} \and Rafael Pinto\\ Lund University}
\date{March 2026}
\keywords{creep, niobium; grain boundaries}
% TODO: switch to biblatex
\begin{document}
\maketitle
\begin{abstract}
We study creep in \tool{} alloys.

A second paragraph with $x^2$.
\end{abstract}
\section{Introduction}
\label{sec:intro}
Creep matters~\cite{smith2020,jones2019} and \citep[p.~3]{smith2020}.
\input{sections/method}
\section*{Acknowledgements}
Thanks \cite{ghost}. \todo{Thank the funders}
\bibliography{refs}
\end{document}
`;

const METHOD = String.raw`\section{Method of \tool{}}
\label{sec:method}
\subsection{Rig}
\begin{figure}[t]
  \centering
  \includegraphics{rig.png}
  \caption[Rig]{The \emph{test} rig.}
  \label{fig:rig}
\end{figure}
\begin{table}
  \caption{Creep rates}\label{tab:rates}
  \begin{tabular}{ll} a & b \end{tabular}
\end{table}
\begin{equation}
  E = mc^2 \label{eq:energy}
\end{equation}
\begin{align*}
  a &= b \\[2pt]
  c &= d
\end{align*}
Line break\\[1mm] is not math. \[ x + y \]
\begin{lemma}\label{lem:bound} Bounded. \end{lemma}
\begin{figure}\includegraphics{raw.png}\end{figure}
% FIXME redo the fit
\begin{verbatim}
TODO inside verbatim \section{Not a heading}
\end{verbatim}
`;

const REFS = "@article{smith2020,\n title={A}}\n@book{jones2019, title={B}}\n@string{x = {y}}\n";

const TEXTS = { "main.tex": MAIN, "sections/method.tex": METHOD, "refs.bib": REFS };

describe("buildLatexInsights", () => {
  it("lists headings in document order through inputs, with levels and labels", () => {
    const { headings } = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    expect(headings.map((entry) => [entry.text, entry.level, entry.label, entry.numbered])).toEqual([
      ["Introduction", 1, "sec:intro", true],
      ["Method of Foundry", 1, "sec:method", true],
      ["Rig", 2, null, true],
      ["Acknowledgements", 1, null, false],
    ]);
    expect(headings[1].location).toEqual({ path: "sections/method.tex", line: 1, column: 1 });
    expect(headings[3].location).toEqual({ path: "main.tex", line: 21, column: 1 });
  });

  it("gives the same headings for files saved with Windows line endings", () => {
    const crlf = Object.fromEntries(Object.entries(TEXTS).map(([path, text]) => [path, text.replaceAll("\n", "\r\n")]));
    const lf = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    const windows = buildLatexInsights({ mainDoc: "main.tex", texts: crlf });
    expect(windows.headings).toEqual(lf.headings);
    expect(windows.todos).toEqual(lf.todos);
  });

  it("lists figures, tables and display equations with captions and labels", () => {
    const insights = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    expect(insights.figures.map((entry) => [entry.text, entry.label, entry.numbered])).toEqual([
      ["The test rig.", "fig:rig", true],
      ["", null, false],
    ]);
    expect(insights.figures[0].location).toEqual({ path: "sections/method.tex", line: 4, column: 1 });
    expect(insights.tables.map((entry) => [entry.text, entry.label])).toEqual([["Creep rates", "tab:rates"]]);
    expect(insights.equations.map((entry) => [entry.text, entry.label, entry.numbered])).toEqual([
      ["E = mc^2", "eq:energy", true],
      [String.raw`a &= b \\[2pt] c &= d`, null, false],
      ["x + y", null, false],
    ]);
  });

  it("gives every label a kind", () => {
    const { labels } = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    expect(labels.map((label) => [label.name, label.kind])).toEqual([
      ["sec:intro", "heading"],
      ["sec:method", "heading"],
      ["fig:rig", "figure"],
      ["tab:rates", "table"],
      ["eq:energy", "equation"],
      ["lem:bound", "other"],
    ]);
    expect(labels[2].location).toEqual({ path: "sections/method.tex", line: 8, column: 3 });
  });

  it("counts citations and flags keys missing from the bibliography", () => {
    const { citations } = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    expect(citations).toEqual([
      { key: "smith2020", count: 2, unresolved: false, location: { path: "main.tex", line: 19, column: 15 } },
      { key: "jones2019", count: 1, unresolved: false, location: { path: "main.tex", line: 19, column: 15 } },
      { key: "ghost", count: 1, unresolved: true, location: { path: "main.tex", line: 22, column: 8 } },
    ]);
  });

  it("does not flag citations when a declared bibliography is not loaded", () => {
    const { citations } = buildLatexInsights({ mainDoc: "main.tex", texts: { "main.tex": MAIN } });
    expect(citations.every((citation) => citation.unresolved === undefined)).toBe(true);
  });

  it("resolves keys from thebibliography", () => {
    const main = String.raw`\begin{document}
See \cite{knuth}.
\begin{thebibliography}{9}
\bibitem[Knuth(1984)]{knuth} D. Knuth.
\end{thebibliography}
\end{document}`;
    const { citations } = buildLatexInsights({ mainDoc: "main.tex", texts: { "main.tex": main } });
    expect(citations).toMatchObject([{ key: "knuth", count: 1, unresolved: false }]);
  });

  it("collects TODO and FIXME notes from comments and todo commands", () => {
    const { todos } = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    expect(todos.map((todo) => [todo.text, todo.location.path, todo.location.line])).toEqual([
      ["TODO: switch to biblatex", "main.tex", 9],
      ["FIXME redo the fit", "sections/method.tex", 24],
      [String.raw`\todo{Thank the funders}`, "main.tex", 22],
    ]);
  });

  it("reads the submission metadata", () => {
    const { metadata } = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS });
    expect(metadata).toEqual({
      title: "Creep in Niobium Alloys",
      authors: ["Elin Hagstrom", "Rafael Pinto"],
      abstract: "We study creep in Foundry alloys.\n\nA second paragraph with $x^2$.",
      keywords: ["creep", "niobium", "grain boundaries"],
      date: "March 2026",
    });
  });

  it("reads keywords from the environments common classes use", () => {
    const read = (body: string) =>
      buildLatexInsights({ mainDoc: "main.tex", texts: { "main.tex": `\\begin{document}\n${body}\n\\end{document}` } })
        .metadata.keywords;
    expect(read(String.raw`\begin{IEEEkeywords}Phase noise, channel estimation\end{IEEEkeywords}`)).toEqual([
      "Phase noise",
      "channel estimation",
    ]);
    expect(read(String.raw`\begin{keyword}creep \sep niobium \end{keyword}`)).toEqual(["creep", "niobium"]);
    expect(read(String.raw`\begin{keyword}\kwd{creep}\kwd{niobium}\end{keyword}`)).toEqual(["creep", "niobium"]);
    expect(read(String.raw`\keywords{First \and Second}`)).toEqual(["First", "Second"]);
  });

  it("reads authors from IEEE and acmart style blocks", () => {
    const read = (preamble: string) =>
      buildLatexInsights({ mainDoc: "main.tex", texts: { "main.tex": `${preamble}\n\\begin{document}\\end{document}` } })
        .metadata.authors;
    expect(read(String.raw`\author{\IEEEauthorblockN{Ada Lovelace, Alan Turing}\IEEEauthorblockA{London}}`)).toEqual([
      "Ada Lovelace",
      "Alan Turing",
    ]);
    expect(read(String.raw`\author{Ben Trovato}\affiliation{\institution{X}}\author{Lars Th{\o}rv{\"a}ld}`)).toEqual([
      "Ben Trovato",
      "Lars Thørväld",
    ]);
    expect(read(String.raw`\author[1]{Jane Doe\corref{cor1}}\author*[2]{\fnm{John} \sur{Roe}}`)).toEqual([
      "Jane Doe",
      "John Roe",
    ]);
    expect(read(String.raw`\author{林思远 \quad 陈雅琳 \And Adaeze Okonkwo\\ \normalsize Institute}`)).toEqual([
      "林思远",
      "陈雅琳",
      "Adaeze Okonkwo",
    ]);
  });

  it("drops layout arguments from the title", () => {
    const main = String.raw`\title{\parbox{0.82\textwidth}{\centering Where the Fibres Settle\\[0.2em]
\Large Tidal \textcolor{blue}{Pumping}}}
\begin{document}\end{document}`;
    expect(buildLatexInsights({ mainDoc: "main.tex", texts: { "main.tex": main } }).metadata.title).toBe(
      "Where the Fibres Settle Tidal Pumping",
    );
  });

  it("adds numbers and pages from the compiled labels", () => {
    const numbers: Record<string, { number: string; page: string }> = {
      "sec:intro": { number: "1", page: "1" },
      "fig:rig": { number: "2", page: "3" },
      "eq:energy": { number: "4", page: "iv" },
    };
    const insights = buildLatexInsights({ mainDoc: "main.tex", texts: TEXTS, numberFor: (label) => numbers[label] ?? null });
    expect(insights.headings[0]).toMatchObject({ number: "1", page: "1" });
    expect(insights.headings[2]).toMatchObject({ number: null, page: null });
    expect(insights.figures[0]).toMatchObject({ number: "2", page: "3" });
    expect(insights.equations[0]).toMatchObject({ number: "4", page: "iv" });
  });

  it("names the inputs and bibliographies that are not loaded yet", () => {
    expect(missingLatexSources("main.tex", { "main.tex": MAIN })).toEqual([
      ["sections/method.tex"],
      ["refs", "refs.bib"],
    ]);
    expect(missingLatexSources("main.tex", TEXTS)).toEqual([]);
  });
});

function readSeed(name: string): Record<string, string> {
  const root = join(process.cwd(), "fixtures/research-seeds", name);
  const texts: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(?:tex|bib)$/u.test(entry)) texts[relative(root, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return texts;
}

describe("buildLatexInsights on research seeds", () => {
  it("summarises the IEEE two-column article", () => {
    const insights = buildLatexInsights({ mainDoc: "main.tex", texts: readSeed("ieee-two-column-journal-article") });
    expect(insights.metadata.title).toBe(
      "Joint Phase-Noise and Channel Estimation for Wideband Hybrid Millimeter-Wave Arrays",
    );
    expect(insights.metadata.authors).toEqual(["Anneke Vermeer", "Sohail Qadri", "Marta Bielecka", "Dominic Achterberg"]);
    expect(insights.metadata.keywords).toEqual([
      "phase noise",
      "channel estimation",
      "millimeter-wave communication",
      "hybrid beamforming",
      "variational inference",
    ]);
    expect(insights.metadata.abstract).toMatch(/^Hybrid millimeter-wave receivers share one local oscillator/u);
    expect(insights.headings[0]).toMatchObject({ text: "Introduction", label: "sec:introduction", level: 1 });
    expect(insights.headings.map((heading) => heading.text)).toContain("The Halyard Estimator");
    expect(insights.headings.at(-1)).toMatchObject({ text: "Acknowledgements", numbered: false });
    expect(insights.figures.map((figure) => figure.label)).toEqual(["fig:chain", "fig:ber"]);
    expect(insights.tables.map((table) => table.label)).toEqual(["tab:complexity", "tab:main"]);
    expect(insights.equations.find((equation) => equation.label === "eq:likelihood")?.numbered).toBe(true);
    expect(insights.labels.find((label) => label.name === "lem:descent")?.kind).toBe("other");
    expect(insights.labels.find((label) => label.name === "eq:h-update-2")?.kind).toBe("equation");
    expect(insights.citations.length).toBeGreaterThan(5);
    expect(insights.citations.filter((citation) => citation.unresolved)).toEqual([]);
  });

  it("reads the keyword line of the ACM-style study", () => {
    const { metadata } = buildLatexInsights({ mainDoc: "main.tex", texts: readSeed("acm-style-hci-user-study") });
    expect(metadata.keywords).toEqual([
      "interruption",
      "task resumption",
      "developer tools",
      "compile feedback",
      "notification design",
    ]);
    expect(metadata.authors).toHaveLength(4);
  });
});
