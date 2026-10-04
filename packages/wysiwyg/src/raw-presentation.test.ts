import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setWysiwygTranslator } from "./messages";
import { compactRawInlineSource, isRawMathSource, rawBlockPresentation } from "./raw-presentation";

describe("compactRawInlineSource citation and reference matching", () => {
  it("compacts citation commands", () => {
    expect(compactRawInlineSource(String.raw`\cite{smith2020}`)).toBe("@smith2020");
    expect(compactRawInlineSource(String.raw`\cite{ a , b }`)).toBe("@a, @b");
    expect(compactRawInlineSource(String.raw`\citep[see][p. 3]{a,b}`)).toBe("@a, @b");
    expect(compactRawInlineSource(String.raw`\textcite*{x}`)).toBe("@x");
    expect(compactRawInlineSource(String.raw`\parencite {y}`)).toBe("@y");
  });

  it("compacts reference commands", () => {
    expect(compactRawInlineSource(String.raw`\ref{fig:one}`)).toBe("§ fig:one");
    expect(compactRawInlineSource(String.raw`\autoref{ tab:two }`)).toBe("§ tab:two");
    expect(compactRawInlineSource(String.raw`\Cref*[x]{eq:three}`)).toBe("§ eq:three");
    expect(compactRawInlineSource(String.raw`\label{sec:x}`)).toBe("#sec:x");
  });

  it("leaves unrelated commands untouched", () => {
    expect(compactRawInlineSource(String.raw`\emph{word}`)).toBe(String.raw`\emph{word}`);
    expect(compactRawInlineSource(String.raw`\cite{}`)).toBe(String.raw`\cite{}`);
    expect(compactRawInlineSource(String.raw`\citefoo{a}{b}`)).toBe(String.raw`\citefoo{a}{b}`);
    expect(compactRawInlineSource(String.raw`\refx{a}`)).toBe(String.raw`\refx{a}`);
  });
});

describe("rawBlockPresentation preview normalization", () => {
  it("normalizes separators, ties and escapes", () => {
    expect(rawBlockPresentation(String.raw`\author{Ann\\Bob}`).preview).toBe("Ann · Bob");
    expect(rawBlockPresentation(String.raw`\author{Ann \and Bob}`).preview).toBe("Ann · Bob");
    expect(rawBlockPresentation(String.raw`\title{X~Y}`).preview).toBe("X Y");
    expect(rawBlockPresentation(String.raw`\author{{\L}odz}`).preview).toBe("Łodz");
    expect(rawBlockPresentation(String.raw`\title{A\ B}`).preview).toBe("A B");
    expect(rawBlockPresentation(String.raw`\title{50\% of \#1}`).preview).toBe("50 % of # 1");
  });
});

describe("rawBlockPresentation labels and previews", () => {
  beforeEach(() => {
    setWysiwygTranslator((key, params) => (params ? `${key}(${Object.values(params).join(",")})` : key));
  });

  afterEach(() => {
    setWysiwygTranslator(null);
  });

  it("names known front-matter commands and environments", () => {
    expect(rawBlockPresentation(String.raw`\title{On Graphs}`)).toEqual({ label: "block.title", preview: "On Graphs" });
    expect(rawBlockPresentation(String.raw`\begin{abstract}We study.\end{abstract}`)).toEqual({
      label: "block.abstract",
      preview: "We study.",
    });
    expect(rawBlockPresentation(String.raw`  \begin{IEEEkeywords}graphs\end{IEEEkeywords}`).label).toBe("block.keywords");
  });

  it("summarises maketitle without trying to read it", () => {
    expect(rawBlockPresentation(String.raw`\maketitle`)).toEqual({
      label: "block.documentTitle",
      preview: "block.maketitlePreview",
    });
  });

  it("previews floats by their caption, or says the float is preserved", () => {
    expect(
      rawBlockPresentation(String.raw`\begin{figure}\includegraphics{a}\caption[short]{Results \& costs}\end{figure}`),
    ).toEqual({ label: "block.figure", preview: "Results & costs" });
    expect(rawBlockPresentation(String.raw`\begin{figure*}\includegraphics{a}\end{figure*}`)).toEqual({
      label: "block.figure",
      preview: "block.figurePreserved",
    });
    expect(rawBlockPresentation(String.raw`\begin{tabular}{ll}a & b\end{tabular}`)).toEqual({
      label: "block.table",
      preview: "block.tablePreserved",
    });
  });

  it("labels comments, other environments, other commands and bare text", () => {
    expect(rawBlockPresentation("% reviewer note\n% second line").label).toBe("block.comment");
    expect(rawBlockPresentation(String.raw`\begin{center}Hello\end{center}`).label).toBe("block.environment(center)");
    expect(rawBlockPresentation(String.raw`\vspace*{2em}`).label).toBe("block.command(vspace*)");
    expect(rawBlockPresentation("plain words").label).toBe("block.latexSource");
  });

  it("falls back to a preserved-source note when nothing readable is left", () => {
    expect(rawBlockPresentation(String.raw`\begin{center}\end{center}`).preview).toBe("block.sourcePreserved");
    expect(rawBlockPresentation("% only a comment").preview).toBe("block.sourcePreserved");
  });

  it("drops comments but keeps escaped percent signs", () => {
    expect(rawBlockPresentation(String.raw`\title{50\% done} % hidden note`).preview).toBe("50 % done");
    expect(rawBlockPresentation(String.raw`\author{Ann\\% hidden`).preview).toBe("Ann ·");
  });

  it("drops thanks footnotes and spacing commands from the preview", () => {
    expect(
      rawBlockPresentation(String.raw`\author{Ann\thanks{Funded}\footnotemark[2] \quad Bob\hfill}`).preview,
    ).toBe("Ann Bob");
  });

  it("truncates long previews with an ellipsis", () => {
    const preview = rawBlockPresentation(`\\title{${"word ".repeat(120)}}`).preview;

    expect(preview.length).toBeLessThanOrEqual(360);
    expect(preview.endsWith("word…")).toBe(true);
  });
});

describe("compactRawInlineSource compact forms", () => {
  it("shows ties as a non-breaking space and a braced comma as a comma", () => {
    expect(compactRawInlineSource("~")).toBe("\u00a0");
    expect(compactRawInlineSource(String.raw`\textasciitilde { }`)).toBe("\u00a0");
    expect(compactRawInlineSource("{,}")).toBe(",");
  });

  it("shows escaped characters as themselves", () => {
    expect(compactRawInlineSource(String.raw`\%`)).toBe("%");
    expect(compactRawInlineSource(String.raw`\_`)).toBe("_");
  });

  it("shows line breaks and fills as symbols", () => {
    expect(compactRawInlineSource(String.raw`\\`)).toBe("↵");
    expect(compactRawInlineSource(String.raw` \hfill `)).toBe("↔");
  });

  it("collapses whitespace and keeps short sources whole", () => {
    expect(compactRawInlineSource("  \\foo\n  {bar}  ")).toBe(String.raw`\foo {bar}`);
  });

  it("shortens long commands to their name and long text to a prefix", () => {
    expect(compactRawInlineSource(String.raw`\includegraphics[width=\linewidth]{figures/a-very-long-file-name-for-a-plot.pdf}`)).toBe(
      String.raw`\includegraphics…`,
    );
    const text = "x".repeat(80);
    expect(compactRawInlineSource(text)).toBe(`${"x".repeat(61)}…`);
  });
});

describe("isRawMathSource edge cases", () => {
  it("rejects a dollar pair whose closing dollar is escaped", () => {
    expect(isRawMathSource(String.raw`$a\$`)).toBe(false);
  });

  it("rejects delimiters with nothing between them", () => {
    expect(isRawMathSource("$$")).toBe(false);
    expect(isRawMathSource("$ $")).toBe(true);
    expect(isRawMathSource(String.raw`\(\)`)).toBe(true);
    expect(isRawMathSource("$$$")).toBe(false);
  });
});
