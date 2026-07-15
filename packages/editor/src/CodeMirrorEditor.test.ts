import { describe, expect, it } from "vitest";
import { isLatexSourcePath, isProseSourcePath } from "./CodeMirrorEditor";

describe("isLatexSourcePath", () => {
  it("keeps LaTeX-only tooling off Typst and support files", () => {
    expect(isLatexSourcePath("main.tex")).toBe(true);
    expect(isLatexSourcePath("MAIN.LATEX")).toBe(true);
    expect(isLatexSourcePath("main.typ")).toBe(false);
    expect(isLatexSourcePath("references.bib")).toBe(false);
  });
});

describe("isProseSourcePath", () => {
  it("enables prose checks for Markdown without enabling them for Typst", () => {
    expect(isProseSourcePath("main.md")).toBe(true);
    expect(isProseSourcePath("paper.MARKDOWN")).toBe(true);
    expect(isProseSourcePath("main.tex")).toBe(true);
    expect(isProseSourcePath("main.typ")).toBe(false);
  });
});
