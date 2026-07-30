export const LARGE_BOOK_LINE_COUNT = 6_200;

const CHAPTER_TITLES = [
  "Observing Complex Systems",
  "Models, Evidence, and Uncertainty",
  "Geometry of the State Space",
  "Signals Across Time",
  "Networks and Collective Behaviour",
  "Inference Under Constraints",
  "Algorithms in Practice",
  "Robust Decisions",
  "Experiments at Scale",
  "Human Factors",
  "Failure, Recovery, and Resilience",
  "Reproducible Workflows",
  "Interpreting Results",
  "Communicating Technical Evidence",
  "Open Problems",
  "A Practical Synthesis",
] as const;

const SECTION_TOPICS = [
  "Motivation and scope",
  "A running example",
  "Assumptions and notation",
  "Measurement design",
  "A constructive derivation",
  "Computational trade-offs",
  "Sensitivity analysis",
  "Interpretation",
  "Boundary cases",
  "Implementation notes",
  "Lessons from deployment",
  "Further questions",
] as const;

const SUBJECTS = [
  "the field team",
  "our measurement protocol",
  "the numerical model",
  "the validation cohort",
  "the archival record",
  "the optimization routine",
  "the sensor network",
  "the review panel",
  "the simulation study",
  "the deployment group",
  "the replication package",
  "the decision process",
] as const;

const ACTIONS = [
  "separates structural variation from noise",
  "preserves assumptions needed for comparison",
  "reveals disagreement between local and global estimates",
  "connects a theoretical bound to an observable quantity",
  "records enough context for independent replication",
  "tests whether the conclusion survives a change of scale",
  "turns an expectation into a falsifiable claim",
  "makes approximation costs explicit",
  "distinguishes prediction from measurement error",
  "aligns interpretation with the available evidence",
  "exposes where the simplified model stops applying",
  "anchors the next stage of analysis",
] as const;

export const LARGE_BOOK_FORMULA_KINDS = [
  "scalar equation",
  "aligned system",
  "matrix factorization",
  "piecewise model",
  "definite integral",
  "finite series",
  "conditional probability",
  "partial derivative",
  "asymptotic limit",
  "vector norm",
] as const;

export interface LargeBookFixture {
  readonly source: string;
  readonly lineCount: number;
  readonly characterCount: number;
  readonly chapterCount: number;
  readonly sectionCount: number;
  readonly mathCount: number;
  readonly displayMathCount: number;
  readonly citationCount: number;
  readonly distinctNonEmptyLineRatio: number;
  readonly formulaKinds: readonly string[];
}

export interface LargeBookProjectFixture extends LargeBookFixture {
  readonly files: Readonly<Record<string, string>>;
}

function proseLine(
  sequence: number,
  chapter: number,
  section: number,
): string {
  const subject = SUBJECTS[(sequence * 5 + chapter) % SUBJECTS.length];
  const action = ACTIONS[(sequence * 7 + section) % ACTIONS.length];
  return `${subject[0].toUpperCase()}${subject.slice(1)} ${action}; case ${chapter}.${section}.${sequence}.`;
}

function countInlineDollarMath(source: string): number {
  let count = 0;
  for (let start = 0; start < source.length; start += 1) {
    if (
      source[start] !== "$" ||
      source[start - 1] === "\\" ||
      source[start - 1] === "$" ||
      source[start + 1] === "$"
    ) {
      continue;
    }
    let hasContent = false;
    for (let cursor = start + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === "\n") break;
      if (character === "\\") {
        if (
          cursor + 1 >= source.length ||
          source[cursor + 1] === "\n"
        ) {
          break;
        }
        cursor += 1;
        hasContent = true;
        continue;
      }
      if (character === "$") {
        if (hasContent) {
          count += 1;
          start = cursor;
        }
        break;
      }
      hasContent = true;
    }
  }
  return count;
}

function displayFormula(
  formulaIndex: number,
): { readonly kind: string; readonly lines: readonly string[] } {
  const id = String(formulaIndex).padStart(4, "0");
  const n = (formulaIndex % 37) + 3;
  const m = (formulaIndex % 23) + 2;
  const kind =
    LARGE_BOOK_FORMULA_KINDS[
      (formulaIndex - 1) % LARGE_BOOK_FORMULA_KINDS.length
    ];

  switch (kind) {
    case "scalar equation":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:energy-${id}} % scalar model ${id}`,
          String.raw`E_{${n}} = \alpha_{${n}} x_{${m}}^2 + \beta_{${m}} y_{${n}} + \varepsilon_{${id}}.`,
          String.raw`\end{equation} % scalar model ${id}`,
        ],
      };
    case "aligned system":
      return {
        kind,
        lines: [
          String.raw`\begin{align} % coupled balance ${id}`,
          String.raw`u_{${n}} &= a_{${n}} + b_{${m}}v_{${n}} \label{eq:u-${id}}\\`,
          String.raw`v_{${n}} &= c_{${m}} - d_{${n}}u_{${m}}. \label{eq:v-${id}}`,
          String.raw`\end{align} % coupled balance ${id}`,
        ],
      };
    case "matrix factorization":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:matrix-${id}} % matrix factorization ${id}`,
          String.raw`\mathbf{A}_{${n}} = \begin{bmatrix} ${n} & ${m} \\ ${m + 1} & ${n + 2} \end{bmatrix} = \mathbf{Q}_{${n}}\mathbf{R}_{${n}}.`,
          String.raw`\end{equation} % matrix factorization ${id}`,
        ],
      };
    case "piecewise model":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:cases-${id}} % piecewise response ${id}`,
          String.raw`f_{${n}}(x)=\begin{cases}x^{${m}},&x<${n},\\ ${n}x+${m},&x\ge ${n}.\end{cases}`,
          String.raw`\end{equation} % piecewise response ${id}`,
        ],
      };
    case "definite integral":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:integral-${id}} % accumulated signal ${id}`,
          String.raw`I_{${n}}=\int_{0}^{${m}}\exp(-${n}t)\sin(${m}t)\,\mathrm{d}t.`,
          String.raw`\end{equation} % accumulated signal ${id}`,
        ],
      };
    case "finite series":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:series-${id}} % finite estimator ${id}`,
          String.raw`\widehat{\mu}_{${n}}=\frac{1}{${n}}\sum_{i=1}^{${n}}\left(x_i-\overline{x}\right)^2.`,
          String.raw`\end{equation} % finite estimator ${id}`,
        ],
      };
    case "conditional probability":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:bayes-${id}} % posterior update ${id}`,
          String.raw`p(\theta_{${n}}\mid D_{${m}})=\frac{p(D_{${m}}\mid\theta_{${n}})p(\theta_{${n}})}{\int p(D_{${m}}\mid\vartheta)p(\vartheta)\,\mathrm{d}\vartheta}.`,
          String.raw`\end{equation} % posterior update ${id}`,
        ],
      };
    case "partial derivative":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:gradient-${id}} % sensitivity gradient ${id}`,
          String.raw`\nabla_{\mathbf{w}}L_{${n}}=\left(\frac{\partial L}{\partial w_1},\ldots,\frac{\partial L}{\partial w_${m}}\right)^{\mathsf{T}}.`,
          String.raw`\end{equation} % sensitivity gradient ${id}`,
        ],
      };
    case "asymptotic limit":
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:limit-${id}} % convergence claim ${id}`,
          String.raw`\lim_{k\to\infty}\left(1+\frac{${n}}{k}\right)^k=\mathrm{e}^{${n}}.`,
          String.raw`\end{equation} % convergence claim ${id}`,
        ],
      };
    default:
      return {
        kind,
        lines: [
          String.raw`\begin{equation}\label{eq:norm-${id}} % geometric bound ${id}`,
          String.raw`\lVert\mathbf{x}_{${n}}-\mathbf{y}_{${m}}\rVert_2\le\sqrt{${n}}\lVert\mathbf{x}_{${n}}-\mathbf{y}_{${m}}\rVert_\infty.`,
          String.raw`\end{equation} % geometric bound ${id}`,
        ],
      };
  }
}

/**
 * Builds a deterministic, compilable book rather than a repeated-line load
 * generator. The document deliberately mixes real authoring constructs:
 * chapters, cross-references, citations, prose paragraphs, ten families of
 * mathematics, theorems, tables, lists, quotations, footnotes and comments.
 *
 * Repeated structural commands carry unique editorial comments so the fixture
 * also catches accidental line aliasing in viewport and diagnostic code.
 */
export function buildLargeLatexBook(
  lineCount = LARGE_BOOK_LINE_COUNT,
): LargeBookFixture {
  if (!Number.isInteger(lineCount) || lineCount < 5_100) {
    throw new Error("Large-book fixtures require at least 5,100 lines.");
  }

  const lines = [
    String.raw`\documentclass[11pt,oneside]{book}`,
    String.raw`\usepackage{amsmath,amssymb,amsthm}`,
    String.raw`\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue]{hyperref}`,
    String.raw`\newtheorem{theorem}{Theorem}[chapter]`,
    String.raw`\newcommand{\bookterm}[1]{\textbf{#1}}`,
    String.raw`\title{Evidence, Models, and Reliable Systems}`,
    String.raw`\author{A Collaborative Research Team}`,
    String.raw`\date{2026}`,
    String.raw`\begin{document}`,
    String.raw`\frontmatter`,
    String.raw`\maketitle`,
    String.raw`\tableofcontents`,
    String.raw`\chapter{How to Read This Book}\label{ch:reading-guide}`,
    "Each chapter connects a formal model to evidence, implementation, and interpretation.",
    String.raw`\mainmatter`,
    String.raw`\chapter{Observing Complex Systems}\label{ch:01}`,
    String.raw`\section{Motivation and scope}\label{sec:01-01}`,
  ];
  const closingLines = [
    String.raw`\backmatter`,
    String.raw`\chapter{References}\label{ch:references}`,
    String.raw`\begin{thebibliography}{9} % embedded sources for an offline build`,
    String.raw`\bibitem{foundations} A. Rivera, \emph{Foundations of Reliable Evidence}, Northwind Press, 2018.`,
    "\\bibitem{systems} M. Chen and R. Okafor, ``Systems That Explain Their Limits,'' 2021.",
    String.raw`\bibitem{numerics} S. Patel, \emph{Numerical Reasoning in Practice}, 2024.`,
    String.raw`\end{thebibliography} % end embedded sources`,
    String.raw`\end{document}`,
  ];
  const bodyLimit = lineCount - closingLines.length;
  let sequence = 1;
  let chapter = 1;
  let section = 1;
  let formulaIndex = 0;
  const encounteredFormulaKinds = new Set<string>();

  const pushBlock = (block: readonly string[]): boolean => {
    if (lines.length + block.length > bodyLimit) return false;
    lines.push(...block);
    return true;
  };

  while (lines.length < bodyLimit) {
    if (sequence % 360 === 0 && chapter < CHAPTER_TITLES.length) {
      chapter++;
      section = 0;
      if (
        pushBlock([
          String.raw`\chapter{${CHAPTER_TITLES[chapter - 1]}}\label{ch:${String(chapter).padStart(2, "0")}}`,
        ])
      ) {
        sequence++;
        continue;
      }
    }
    if (sequence % 72 === 0 || section === 0) {
      section++;
      if (
        pushBlock([
          String.raw`\section{${SECTION_TOPICS[(section - 1) % SECTION_TOPICS.length]}}\label{sec:${String(chapter).padStart(2, "0")}-${String(section).padStart(2, "0")}}`,
        ])
      ) {
        sequence++;
        continue;
      }
    }

    if (sequence % 41 === 0) {
      const display = displayFormula(++formulaIndex);
      if (pushBlock(display.lines)) {
        encounteredFormulaKinds.add(display.kind);
        sequence++;
        continue;
      }
    }

    const id = `${String(chapter).padStart(2, "0")}-${String(section).padStart(2, "0")}-${String(sequence).padStart(4, "0")}`;
    if (
      sequence % 173 === 0 &&
      pushBlock([
        String.raw`\begin{table}[htbp] % empirical summary ${id}`,
        String.raw`\centering % table alignment ${id}`,
        String.raw`\caption{Observed trade-offs for scenario ${id}}\label{tab:${id}}`,
        String.raw`\begin{tabular}{lrr} % tabular data ${id}`,
        String.raw`Configuration & Accuracy & Cost \\ \hline`,
        String.raw`Baseline ${id} & ${80 + (sequence % 17)}\% & ${10 + (sequence % 9)} \\`,
        String.raw`Robust ${id} & ${84 + (sequence % 13)}\% & ${14 + (sequence % 11)} \\`,
        String.raw`\end{tabular} % tabular data ${id}`,
        String.raw`\end{table} % empirical summary ${id}`,
      ])
    ) {
      sequence++;
      continue;
    }
    if (
      sequence % 137 === 0 &&
      pushBlock([
        String.raw`\begin{theorem}[Stability for scenario ${id}]\label{thm:${id}}`,
        String.raw`If $\lVert\Delta_${sequence}\rVert_2<${(sequence % 9) + 1}$, the estimator remains bounded for every recorded observation.`,
        String.raw`\end{theorem} % stability result ${id}`,
        String.raw`\begin{proof} % proof ${id}`,
        String.raw`Apply Equation~\ref{eq:energy-${String(Math.max(1, formulaIndex - ((formulaIndex - 1) % 10))).padStart(4, "0")}} and use the triangle inequality at stage ${sequence}.`,
        String.raw`\end{proof} % proof ${id}`,
      ])
    ) {
      sequence++;
      continue;
    }
    if (
      sequence % 113 === 0 &&
      pushBlock([
        String.raw`\begin{enumerate} % review checklist ${id}`,
        String.raw`\item Verify the sampling assumptions for scenario ${id}.`,
        String.raw`\item Compare the robust estimate with baseline ${sequence}.`,
        String.raw`\item Record the decision threshold before examining outcome ${sequence + 1}.`,
        String.raw`\end{enumerate} % review checklist ${id}`,
      ])
    ) {
      sequence++;
      continue;
    }
    if (
      sequence % 97 === 0 &&
      pushBlock([
        String.raw`\begin{quote} % field note ${id}`,
        `A model earns trust by explaining where it fails; field note ${id} records that boundary.`,
        String.raw`\end{quote} % field note ${id}`,
      ])
    ) {
      sequence++;
      continue;
    }
    if (sequence % 53 === 0) {
      lines.push(
        String.raw`At checkpoint ${id}, the normalized residual is $r_{${sequence}}=(y_{${sequence}}-\widehat{y}_{${sequence}})/\sigma_{${chapter}}$, which keeps units comparable.`,
      );
    } else if (sequence % 47 === 0) {
      lines.push(
        String.raw`The argument follows Section~\ref{sec:${String(chapter).padStart(2, "0")}-${String(section).padStart(2, "0")}} and is consistent with the workflow in Chapter~\ref{ch:${String(chapter).padStart(2, "0")}}.`,
      );
    } else if (sequence % 43 === 0) {
      const source = ["foundations", "systems", "numerics"][
        sequence % 3
      ];
      lines.push(
        String.raw`Independent evidence for decision ${id} is discussed in \cite{${source}}, including the limitations of the reported baseline.`,
      );
    } else if (sequence % 251 === 0) {
      lines.push(
        `Editorial checkpoint ${id} deliberately contains qwertzuiopz so the live dictionary pipeline remains observable.`,
      );
    } else if (sequence % 29 === 0) {
      lines.push(
        String.raw`The sensitivity coefficient $\gamma_{${sequence}}=${((sequence % 19) + 1) / 10}$ changes the conclusion only when the confidence interval crosses zero.`,
      );
    } else if (sequence % 23 === 0) {
      lines.push(
        `A reviewer can inspect assumption ${id} without rerunning the entire pipeline\\footnote{Audit note ${id} identifies the exact input revision.}.`,
      );
    } else if (sequence % 7 === 0) {
      lines.push(String.raw`\par % deliberate paragraph boundary ${id}`);
    } else {
      lines.push(proseLine(sequence, chapter, section));
    }
    sequence++;
  }

  lines.push(...closingLines);
  const source = lines.join("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const distinctNonEmptyLineRatio =
    new Set(nonEmptyLines).size / nonEmptyLines.length;
  const mathCount = countInlineDollarMath(source);

  return {
    source,
    lineCount: lines.length,
    characterCount: source.length,
    chapterCount: (source.match(/^\\chapter\{/gmu) ?? []).length,
    sectionCount: (source.match(/^\\section\{/gmu) ?? []).length,
    mathCount,
    displayMathCount: formulaIndex,
    citationCount: (source.match(/\\cite\{/gu) ?? []).length,
    distinctNonEmptyLineRatio,
    formulaKinds: [...encounteredFormulaKinds],
  };
}

/**
 * A realistic project tree surrounding the 6,200-line main manuscript. The
 * main file remains independently book-scale while the auxiliary files keep
 * file-tree, indexing and bibliography work mounted during native stress.
 */
export function buildLargeLatexBookProject(
  lineCount = LARGE_BOOK_LINE_COUNT,
): LargeBookProjectFixture {
  const book = buildLargeLatexBook(lineCount);
  return {
    ...book,
    files: {
      "main.tex": book.source,
      "frontmatter/reading-guide.tex": String.raw`\chapter*{Reading Guide}
This guide records the intended path through the model, evidence, and implementation chapters.
`,
      "appendices/notation.tex": String.raw`\chapter{Notation}
\begin{description}
\item[$\theta$] A parameter inferred from observations.
\item[$D$] The complete recorded data set.
\item[$\varepsilon$] A model discrepancy or measurement error.
\end{description}
`,
      "notes/editorial-checklist.md": `# Editorial checklist

- Recompile after structural edits.
- Verify every cross-reference and citation.
- Review equations, tables, and accessibility descriptions.
- Run spelling and grammar checks before export.
`,
      "references.bib": `@book{field-handbook,
  author = {Ana Rivera},
  title = {A Field Handbook for Reliable Evidence},
  year = {2018}
}

@article{transparent-systems,
  author = {Mei Chen and Remi Okafor},
  title = {Transparent Systems in Practice},
  year = {2021}
}

@book{numerical-workflows,
  author = {Samir Patel},
  title = {Numerical Workflows},
  year = {2024}
}
`,
    },
  };
}

export function buildReferenceProject(
  fileCount = 200,
): Readonly<Record<string, string>> {
  if (!Number.isInteger(fileCount) || fileCount < 1 || fileCount > 200) {
    throw new Error("Reference projects support between 1 and 200 files.");
  }

  return Object.fromEntries(
    Array.from({ length: fileCount }, (_, index) => {
      const number = index + 1;
      const previous = index === 0 ? fileCount : index;
      const body = Array.from({ length: 31 }, (_unused, paragraph) => {
        const scenario = number * 31 + paragraph + 1;
        return `Scenario ${scenario} records observation ${paragraph + 1}, uncertainty ${(scenario % 17) + 1}, and decision ${number}.${paragraph + 1}.`;
      });
      return [
        `chapters/chapter-${String(number).padStart(3, "0")}.tex`,
        [
          String.raw`\section{Chapter ${number}}\label{chapter:${number}}`,
          ...body,
          String.raw`See Chapter~\ref{chapter:${previous}} and \cite{book-source}.`,
        ].join("\n"),
      ];
    }),
  );
}
