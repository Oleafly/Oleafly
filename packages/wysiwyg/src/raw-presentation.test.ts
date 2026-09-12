import { describe, expect, it } from "vitest";
import { compactRawInlineSource, rawBlockPresentation } from "./raw-presentation";

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
