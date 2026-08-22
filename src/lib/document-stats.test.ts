import { describe, expect, it } from "vitest";
import {
  EMPTY_DOCUMENT_STATS,
  documentStats,
  sumDocumentStats,
} from "./document-stats";

describe("documentStats", () => {
  it("splits prose into text, headers, and outside-text buckets", () => {
    const stats = documentStats(
      [
        "\\section{Results of the study}",
        "The measured response was clearly nonlinear.",
        "\\begin{figure}",
        "\\caption{Response curve for the sample}",
        "\\end{figure}",
      ].join("\n"),
    );

    expect(stats.wordsInHeaders).toBe(4);
    expect(stats.wordsOutsideText).toBe(5);
    expect(stats.wordsInText).toBe(6);
  });

  it("keeps the three word buckets summing to the total", () => {
    const stats = documentStats(
      [
        "\\chapter{Introduction}",
        "Some body prose here.",
        "\\subsection[Short]{A longer subsection title}",
        "More body prose with a \\footnote{footnote aside} attached.",
      ].join("\n"),
    );

    expect(stats.wordsInText + stats.wordsInHeaders + stats.wordsOutsideText).toBe(
      stats.words,
    );
  });

  it("counts a short-title optional argument once, not twice", () => {
    const stats = documentStats("\\section[Short form]{The full section title}\n");

    expect(stats.headers).toBe(1);
    expect(stats.wordsInHeaders).toBe(4);
  });

  it("counts headings across every sectioning level, starred included", () => {
    const stats = documentStats(
      [
        "\\part{One}",
        "\\chapter{Two}",
        "\\section*{Three}",
        "\\subsection{Four}",
        "\\subsubsection{Five}",
        "\\paragraph{Six}",
        "\\subparagraph{Seven}",
      ].join("\n"),
    );

    expect(stats.headers).toBe(7);
  });

  it("counts figure environments including starred and wrapped ones", () => {
    const stats = documentStats(
      [
        "\\begin{figure}\\end{figure}",
        "\\begin{figure*}\\end{figure*}",
        "\\begin{wrapfigure}{r}{0.4\\textwidth}\\end{wrapfigure}",
        "\\begin{table}\\end{table}",
      ].join("\n"),
    );

    expect(stats.figures).toBe(3);
  });

  it("separates inline from displayed math across delimiters and environments", () => {
    const stats = documentStats(
      [
        "Inline $a^2 + b^2$ and \\( c^2 \\) here.",
        "\\[ E = mc^2 \\]",
        "\\begin{equation}x = 1\\end{equation}",
        "\\begin{align*}y &= 2\\end{align*}",
      ].join("\n"),
    );

    expect(stats.mathInline).toBe(2);
    expect(stats.mathDisplayed).toBe(3);
  });

  it("does not double-count helper environments nested in display math", () => {
    const stats = documentStats(
      "\\begin{equation}\\begin{split}a &= b\\end{split}\\end{equation}\n",
    );

    expect(stats.mathDisplayed).toBe(1);
  });

  it("ignores commented-out structure", () => {
    const stats = documentStats(
      ["% \\section{Not a heading}", "% \\begin{figure}", "Real prose."].join("\n"),
    );

    expect(stats.headers).toBe(0);
    expect(stats.figures).toBe(0);
  });

  it("does not treat an escaped percent as the start of a comment", () => {
    const stats = documentStats("Growth of 40\\% overall.\n\\section{After}\n");

    expect(stats.headers).toBe(1);
  });

  it("survives an unbalanced brace without hanging or throwing", () => {
    const stats = documentStats("\\section{Never closed\nStill some prose.\n");

    expect(stats.headers).toBe(0);
    expect(stats.words).toBeGreaterThan(0);
  });

  it("keeps equation bodies and citation keys out of the word count", () => {
    const withMath = documentStats("Text \\cite{smith2020a} and $\\alpha\\beta\\gamma$.\n");

    expect(withMath.words).toBe(2);
  });

  it("reports zeroes for an empty document", () => {
    expect(documentStats("")).toEqual(EMPTY_DOCUMENT_STATS);
  });
});

describe("sumDocumentStats", () => {
  it("adds every field across files", () => {
    const total = sumDocumentStats([
      documentStats("\\section{One}\nAlpha beta.\n"),
      documentStats("\\section{Two}\nGamma delta epsilon.\n"),
    ]);

    expect(total.headers).toBe(2);
    expect(total.wordsInText).toBe(5);
    expect(total.wordsInHeaders).toBe(2);
  });

  it("returns the empty summary for no files", () => {
    expect(sumDocumentStats([])).toEqual(EMPTY_DOCUMENT_STATS);
  });
});
