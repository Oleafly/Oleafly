import { describe, expect, it } from "vitest";
import { type ChapterImportInput, type ChapterSourceFile, planChapterImport } from "./chapter-import";
import { applyTextEdits } from "./file-references";

const THESIS_MAIN = String.raw`\documentclass{report}
\usepackage{amsmath}
\usepackage{graphicx}
\newcommand{\R}{\mathbb{R}}
\newcommand{\vect}[1]{\boldsymbol{#1}}
\begin{document}
\tableofcontents
\include{chapters/intro}
\appendix
\include{chapters/extra}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;

const THESIS_INTRO = String.raw`\chapter{Introduction}\label{sec:intro}
See \cref{sec:intro}.
`;

const PAPER_MAIN = String.raw`\documentclass{article}
\usepackage{amsmath,booktabs}
\usepackage[capitalise]{cleveref}
\usepackage{graphicx}
\graphicspath{{figures/}}
\newcommand{\R}{\mathbb{R}}
\newcommand{\method}{PS-FCN}
\newcommand{\vect}[1]{\mathbf{#1}}
\DeclareMathOperator*{\argmin}{arg\,min}
\title{PS-FCN: A Flexible Network\thanks{Code online.} for Photometric Stereo}
\author{A. Author}
\begin{document}
\maketitle
\begin{abstract}
We present \method{}.
\end{abstract}
\section{Introduction}
\label{sec:intro}
We estimate $\vect{n} \in \R^3$ and refer to \cref{sec:method,fig:pipeline}.
\input{sections/method}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;

const PAPER_METHOD = String.raw`\section{Method}\label{sec:method}
\begin{figure}
\includegraphics[width=\linewidth]{pipeline}
\caption{The \method{} pipeline.}\label{fig:pipeline}
\end{figure}
The normal $\vect{n}$ minimises $\argmin_x f$, as in \eqref{eq:loss} and \vector.
% \vect{commented}
\begin{equation}\label{eq:loss} L = \|\vect{n}\| \end{equation}
`;

function files(texts: Record<string, string>): ChapterSourceFile[] {
  return Object.entries(texts).map(([path, content]) => ({ path, content }));
}

function input(overrides: Partial<ChapterImportInput> = {}, paper: Record<string, string> = {}): ChapterImportInput {
  return {
    thesis: {
      main: "main.tex",
      files: files({ "main.tex": THESIS_MAIN, "chapters/intro.tex": THESIS_INTRO, "chapters/extra.tex": "" }),
      paths: ["main.tex", "chapters", "chapters/intro.tex", "chapters/extra.tex", "refs.bib"],
    },
    paper: {
      name: "PS-FCN paper",
      main: "main.tex",
      files: files({ "main.tex": PAPER_MAIN, "sections/method.tex": PAPER_METHOD, ...paper }),
      assets: ["figures/pipeline.pdf", "figures/unused.png", "refs.bib"],
    },
    slug: "ps-fcn",
    ...overrides,
  };
}

function written(plan: ReturnType<typeof planChapterImport>, path: string): string | undefined {
  return plan.files.find((file) => file.path === path)?.content;
}

describe("planChapterImport", () => {
  it("turns a paper into a chapter folder and wires it into the thesis", () => {
    const plan = planChapterImport(input());
    expect(plan.blockers).toEqual([]);
    expect(plan.root).toBe("chapters/ps-fcn");
    expect(plan.files.map((file) => file.path)).toEqual([
      "chapters/ps-fcn/chapter.tex",
      "chapters/ps-fcn/macros.tex",
      "chapters/ps-fcn/sections/method.tex",
    ]);
    expect(written(plan, "chapters/ps-fcn/chapter.tex")).toBe(String.raw`\chapter{PS-FCN: A Flexible Network for Photometric Stereo}

\section*{Abstract}
We present \method{}.
\section{Introduction}
\label{ps-fcn:sec:intro}
We estimate $\vectPsFcn{n} \in \R^3$ and refer to \cref{ps-fcn:sec:method,ps-fcn:fig:pipeline}.
\input{chapters/ps-fcn/sections/method}
`);
    expect(written(plan, "chapters/ps-fcn/macros.tex")).toBe(String.raw`\newcommand{\method}{PS-FCN}
\newcommand{\vectPsFcn}[1]{\mathbf{#1}}
\DeclareMathOperator*{\argmin}{arg\,min}
`);
    expect(written(plan, "chapters/ps-fcn/sections/method.tex")).toBe(String.raw`\section{Method}\label{ps-fcn:sec:method}
\begin{figure}
\includegraphics[width=\linewidth]{chapters/ps-fcn/figures/pipeline}
\caption{The \method{} pipeline.}\label{ps-fcn:fig:pipeline}
\end{figure}
The normal $\vectPsFcn{n}$ minimises $\argmin_x f$, as in \eqref{ps-fcn:eq:loss} and \vector.
% \vect{commented}
\begin{equation}\label{ps-fcn:eq:loss} L = \|\vectPsFcn{n}\| \end{equation}
`);
    expect(plan.assets).toEqual([
      { from: "refs.bib", to: "chapters/ps-fcn/refs.bib" },
      { from: "figures/pipeline.pdf", to: "chapters/ps-fcn/figures/pipeline.pdf" },
    ]);
    expect(plan.definitions).toBe(3);
    expect(plan.clashes).toEqual([
      {
        name: String.raw`\vect`,
        kind: "command",
        paper: String.raw`\newcommand{\vect}[1]{\mathbf{#1}}`,
        thesis: String.raw`\newcommand{\vect}[1]{\boldsymbol{#1}}`,
        renamed: String.raw`\vectPsFcn`,
        choice: "rename",
      },
    ]);
    expect(plan.labels).toEqual({ count: 4, duplicates: ["sec:intro"], prefix: true });
    expect(plan.packages).toEqual([
      { name: "booktabs", line: String.raw`\usepackage{booktabs}` },
      { name: "cleveref", line: String.raw`\usepackage[capitalise]{cleveref}` },
    ]);
    expect(plan.bibliographies).toEqual(["chapters/ps-fcn/refs.bib"]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.lines).toEqual([String.raw`\input{chapters/ps-fcn/macros}`, String.raw`\include{chapters/ps-fcn/chapter}`]);
    expect(applyTextEdits(THESIS_MAIN, plan.mainEdits)).toBe(String.raw`\documentclass{report}
\usepackage{amsmath}
\usepackage{graphicx}
\newcommand{\R}{\mathbb{R}}
\newcommand{\vect}[1]{\boldsymbol{#1}}
\input{chapters/ps-fcn/macros}

\begin{document}
\tableofcontents
\include{chapters/intro}
\include{chapters/ps-fcn/chapter}

\appendix
\include{chapters/extra}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`);
  });

  it("keeps the thesis version of a clashing macro and leaves labels alone when asked", () => {
    const plan = planChapterImport(input({ clashes: { [String.raw`\vect`]: "keep" }, prefixLabels: false }));
    expect(plan.clashes.map((clash) => clash.choice)).toEqual(["keep"]);
    expect(written(plan, "chapters/ps-fcn/macros.tex")).not.toContain(String.raw`\vect`);
    const method = written(plan, "chapters/ps-fcn/sections/method.tex");
    expect(method).toContain(String.raw`$\vect{n}$`);
    expect(method).toContain(String.raw`\label{fig:pipeline}`);
    expect(written(plan, "chapters/ps-fcn/chapter.tex")).toContain(String.raw`\cref{sec:method,fig:pipeline}`);
    expect(plan.labels.prefix).toBe(false);
  });

  it("leaves labels unprefixed by default when none of them is taken", () => {
    const thesis = input().thesis;
    const plan = planChapterImport(
      input({ thesis: { ...thesis, files: thesis.files.filter((file) => file.path !== "chapters/intro.tex") } }),
    );
    expect(plan.labels).toEqual({ count: 4, duplicates: [], prefix: false });
    expect(written(plan, "chapters/ps-fcn/chapter.tex")).toContain(String.raw`\label{sec:intro}`);
  });

  it("never writes over an existing chapter folder and checks the slug", () => {
    const thesis = input().thesis;
    expect(planChapterImport(input({ thesis: { ...thesis, paths: [...thesis.paths, "Chapters/PS-FCN/old.tex"] } })).blockers).toEqual([
      "exists",
    ]);
    expect(planChapterImport(input({ slug: "ps fcn" })).blockers).toEqual(["slug"]);
    expect(planChapterImport(input({ slug: "../escape" })).blockers).toEqual(["slug"]);
  });

  it("does not add the chapter line twice", () => {
    const thesis = input().thesis;
    const main = THESIS_MAIN.replace(String.raw`\appendix`, String.raw`\include{chapters/ps-fcn/chapter}` + "\n" + String.raw`\appendix`);
    const plan = planChapterImport(
      input({
        thesis: {
          ...thesis,
          files: thesis.files.map((file) => (file.path === "main.tex" ? { ...file, content: main } : file)),
        },
      }),
    );
    expect(plan.lines).toEqual([String.raw`\input{chapters/ps-fcn/macros}`]);
    expect(plan.mainEdits).toHaveLength(1);
  });

  it("places the chapter under a thesis main that lives in a folder", () => {
    const plan = planChapterImport(
      input({
        thesis: {
          main: "src/thesis.tex",
          files: files({ "src/thesis.tex": THESIS_MAIN }),
          paths: ["src", "src/thesis.tex"],
        },
      }),
    );
    expect(plan.root).toBe("src/chapters/ps-fcn");
    expect(plan.assets[0]).toEqual({ from: "refs.bib", to: "src/chapters/ps-fcn/refs.bib" });
    expect(written(plan, "src/chapters/ps-fcn/chapter.tex")).toContain(String.raw`\input{chapters/ps-fcn/sections/method}`);
    expect(plan.lines).toEqual([String.raw`\input{chapters/ps-fcn/macros}`, String.raw`\include{chapters/ps-fcn/chapter}`]);
  });

  it("reports a paper or thesis without a document body", () => {
    const plan = planChapterImport(input({}, { "main.tex": String.raw`\newcommand{\x}{y}` }));
    expect(plan.blockers).toEqual(["paperDocument"]);
    expect(plan.files).toEqual([]);
    expect(plan.title).toBe("PS-FCN paper");
    const thesis = input().thesis;
    expect(
      planChapterImport(input({ thesis: { ...thesis, files: files({ "main.tex": "\\chapter{Loose}" }) } })).blockers,
    ).toEqual(["thesisDocument"]);
  });

  it("merges preamble inputs, renames clashing theorems and guards built-in overrides", () => {
    const thesis = input().thesis;
    const thesisMain = THESIS_MAIN.replace(
      String.raw`\begin{document}`,
      String.raw`\newtheorem{theorem}{Theorem}[chapter]` + "\n" + String.raw`\begin{document}`,
    );
    const paperMain = String.raw`\documentclass{article}
\input{math_commands}
\renewcommand{\figurename}{Fig.}
\title{}
\begin{document}
\begin{theorem}\label{thm:main}Holds.\end{theorem}
\begin{lemma}A lemma.\end{lemma}
\include{chapter}
\input{missing/file}
\end{document}
`;
    const plan = planChapterImport(
      input(
        {
          thesis: {
            ...thesis,
            files: thesis.files.map((file) => (file.path === "main.tex" ? { ...file, content: thesisMain } : file)),
          },
        },
        {
          "main.tex": paperMain,
          "math_commands.tex": String.raw`\newtheorem{theorem}{Theorem}
\newtheorem{lemma}[theorem]{Lemma}
`,
          "chapter.tex": String.raw`\section{Old chapter file}\input{sections/method}`,
        },
      ),
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.title).toBe("PS-FCN paper");
    expect(plan.clashes.map((clash) => [clash.name, clash.thesis, clash.renamed])).toEqual([
      ["theorem", String.raw`\newtheorem{theorem}{Theorem}[chapter]`, "theoremPsFcn"],
      [String.raw`\figurename`, null, String.raw`\figurenamePsFcn`],
    ]);
    expect(written(plan, "chapters/ps-fcn/macros.tex")).toBe(String.raw`\newtheorem{theoremPsFcn}{Theorem}
\newtheorem{lemma}[theoremPsFcn]{Lemma}
\newcommand{\figurenamePsFcn}{Fig.}
`);
    expect(plan.files.map((file) => file.path)).toEqual([
      "chapters/ps-fcn/chapter.tex",
      "chapters/ps-fcn/macros.tex",
      "chapters/ps-fcn/chapter-2.tex",
      "chapters/ps-fcn/sections/method.tex",
    ]);
    expect(written(plan, "chapters/ps-fcn/chapter.tex")).toBe(String.raw`\chapter{PS-FCN paper}

\begin{theoremPsFcn}\label{thm:main}Holds.\end{theoremPsFcn}
\begin{lemma}A lemma.\end{lemma}
\input{chapters/ps-fcn/chapter-2}
\input{missing/file}
`);
    expect(plan.unresolved).toEqual(["missing/file", "pipeline"]);
  });
});
