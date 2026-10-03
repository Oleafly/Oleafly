import { describe, expect, it } from "vitest";
import { textToBase64 } from "@/lib/base64";
import { flattenLatexInputs, typstSupportFiles } from "./arxiv-typst";

function file(path: string, text: string) {
  return { path, dataBase64: textToBase64(text) };
}

describe("flattenLatexInputs", () => {
  it("inlines input, include, and subfile commands relative to the main file", () => {
    const files = [
      file("paper/main.tex", ""),
      file("paper/sections/intro.tex", "Intro text with \\input{sections/detail}."),
      file("paper/sections/detail.tex", "Deep detail"),
      file("paper/results.tex", "Results body"),
      file("shared/macros.tex", "\\newcommand{\\R}{\\mathbb{R}}"),
    ];
    const main = [
      "\\documentclass{article}",
      "\\input{../shared/macros}",
      "\\begin{document}",
      "\\input{sections/intro.tex}",
      "\\include{results}",
      "\\subfile{missing}",
      "\\end{document}",
    ].join("\n");
    const flattened = flattenLatexInputs(main, "paper/main.tex", files);
    expect(flattened).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(flattened).toContain("Intro text with Deep detail.");
    expect(flattened).toContain("Results body");
    expect(flattened).toContain("\\subfile{missing}");
    expect(flattened).not.toContain("\\input{");
  });

  it("leaves commented inputs alone and stops at runaway recursion", () => {
    const files = [file("loop.tex", "again \\input{loop}")];
    const main = "% \\input{loop}\nText \\% kept \\input{loop}";
    const flattened = flattenLatexInputs(main, "main.tex", files);
    expect(flattened.startsWith("% \\input{loop}\n")).toBe(true);
    expect(flattened.match(/again/g)?.length).toBe(8);
    expect(flattened).toContain("\\input{loop}");
  });

  it("reads inputs written without braces", () => {
    const flattened = flattenLatexInputs("A \\input body.tex B", "main.tex", [file("body.tex", "inner")]);
    expect(flattened).toBe("A inner B");
  });
});

describe("typstSupportFiles", () => {
  it("keeps figures and bibliographies, rebased next to the converted main file", () => {
    const files = [
      file("paper/main.tex", "x"),
      file("paper/figs/plot.png", "png"),
      file("paper/refs.bib", "@misc{a}"),
      file("paper/macros.sty", "x"),
      file("paper/main.bbl", "x"),
      file("other/logo.pdf", "pdf"),
    ];
    expect(typstSupportFiles(files, "paper/main.tex").map((entry) => entry.path)).toEqual([
      "figs/plot.png",
      "refs.bib",
      "other/logo.pdf",
    ]);
    expect(typstSupportFiles(files, "main.tex").map((entry) => entry.path)).toEqual([
      "paper/figs/plot.png",
      "paper/refs.bib",
      "other/logo.pdf",
    ]);
  });

  it("drops a file the rebase would collide with the converted main document", () => {
    const files = [file("paper/main.typ", "old"), file("main.typ", "root")];
    expect(typstSupportFiles(files, "paper/main.tex")).toEqual([]);
  });
});
