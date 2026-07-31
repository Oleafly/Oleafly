import { describe, expect, it } from "vitest";
import {
  cleanLatex,
  extractKeywords,
  splitIntoParagraphs,
} from "./latex-paragraphs";

describe("splitIntoParagraphs", () => {
  it("uses body between begin/end document and skips structural chunks", () => {
    const source = String.raw`
\documentclass{article}
\begin{document}
\section{Intro}

Graph neural networks are used for molecule generation in this work.
The method extends prior message-passing approaches with a novel decoder.

\begin{figure}
\includegraphics{x}
\end{figure}

% just a comment block

\end{document}
\bibliography{refs}
`;
    const paras = splitIntoParagraphs(source);
    expect(paras.length).toBeGreaterThanOrEqual(1);
    expect(paras[0].text).toMatch(/Graph neural networks/i);
    expect(paras.every((p) => !p.text.includes("\\includegraphics"))).toBe(true);
  });

  it("caps at maxParagraphs", () => {
    const body = Array.from({ length: 30 }, (_, i) =>
      `This is paragraph number ${i} with enough prose to pass the minimum length filter for scanning.`,
    ).join("\n\n");
    const source = `\\begin{document}\n${body}\n\\end{document}`;
    expect(splitIntoParagraphs(source, { maxParagraphs: 5 })).toHaveLength(5);
  });
});

describe("extractKeywords", () => {
  it("strips cite commands and returns content words", () => {
    const q = extractKeywords(
      "We use graph neural networks \\citep{kipf2017} for molecular generation tasks.",
    );
    expect(q.toLowerCase()).toContain("graph");
    expect(q.toLowerCase()).toContain("neural");
    expect(q).not.toMatch(/kipf/i);
  });
});

describe("cleanLatex", () => {
  it("removes simple markup wrappers", () => {
    expect(cleanLatex("\\textbf{Hello} world")).toMatch(/Hello world/);
  });
});
