import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import type { FileAnalysis } from "./types";

const REGION_DOCUMENT = [
  String.raw`\documentclass{article}`,
  String.raw`\begin{document}`,
  "%begin novalidate",
  String.raw`\begin{itemize}`,
  String.raw`  \item generated`,
  "%end novalidate",
  String.raw`\begin{enumerate}`,
  String.raw`\end{document}`,
  "",
].join("\n");

const FILE_DOCUMENT = [
  "%novalidate",
  String.raw`\documentclass{article}`,
  String.raw`\begin{document}`,
  String.raw`\begin{itemize}`,
  String.raw`  \item one`,
  String.raw`\end{document}`,
  "",
].join("\n");

function syntaxSpans(file: FileAnalysis, source: string): string[] {
  return file.diagnostics
    .filter((diagnostic) => diagnostic.code === "malformed-source")
    .map((diagnostic) =>
      source.slice(
        diagnostic.location.range.from,
        diagnostic.location.range.to,
      ),
    );
}

describe("project intelligence: %novalidate", () => {
  it("reports the region document without the escape hatch", () => {
    const source = REGION_DOCUMENT.replace("%begin novalidate\n", "")
      .replace("%end novalidate\n", "");
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(syntaxSpans(file, source)).toContain(String.raw`\begin{itemize}`);
  });

  it("does not read environments opened inside a region", () => {
    const file = analyzeProjectFile("main.tex", REGION_DOCUMENT, 1);
    const spans = syntaxSpans(file, REGION_DOCUMENT);
    expect(spans).not.toContain(String.raw`\begin{itemize}`);
    expect(spans).toContain(String.raw`\begin{enumerate}`);
  });

  it("keeps the region text out of the delimiter scan", () => {
    const source = [
      String.raw`\documentclass{article}`,
      "%begin novalidate",
      String.raw`$ \begin{a} } \unfinished{`,
      "%end novalidate",
      "after",
      "",
    ].join("\n");
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(syntaxSpans(file, source)).toEqual([]);
    expect(file.status).toBe("success");
  });

  it("silences syntax diagnostics for a file-level directive", () => {
    const file = analyzeProjectFile("main.tex", FILE_DOCUMENT, 1);
    expect(file.diagnostics).toEqual([]);
    expect(file.status).toBe("success");
  });

  it("silences the file from a directive that appears after the damage", () => {
    const source = `${FILE_DOCUMENT}%novalidate\n`;
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(file.diagnostics).toEqual([]);
  });

  it("ignores a marker that is not the whole comment line", () => {
    const source = FILE_DOCUMENT.replace(
      "%novalidate",
      "% novalidate soon, not yet",
    );
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(syntaxSpans(file, source)).toContain(String.raw`\begin{itemize}`);
  });

  it("ignores an escaped percent", () => {
    const source = FILE_DOCUMENT.replace("%novalidate", String.raw`\%novalidate`);
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(syntaxSpans(file, source)).toContain(String.raw`\begin{itemize}`);
  });

  it("runs a region to the end of the file when it is never closed", () => {
    const source = [
      String.raw`\documentclass{article}`,
      "%begin novalidate",
      String.raw`\begin{itemize}`,
      String.raw`  \item one`,
      "",
    ].join("\n");
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(syntaxSpans(file, source)).toEqual([]);
  });

  it("keeps indexing definitions and uses inside a region", () => {
    const source = [
      String.raw`\documentclass{article}`,
      "%begin novalidate",
      String.raw`\label{generated}`,
      String.raw`\begin{itemize}`,
      "%end novalidate",
      String.raw`\ref{generated}`,
      "",
    ].join("\n");
    const file = analyzeProjectFile("main.tex", source, 1);
    expect(
      file.definitions.some((definition) => definition.name === "generated"),
    ).toBe(true);
    expect(file.uses.some((use) => use.name === "generated")).toBe(true);
  });

  it("leaves Typst sources untouched", () => {
    const source = ["%novalidate", "#figure[", ""].join("\n");
    const file = analyzeProjectFile("main.typ", source, 1);
    expect(
      file.diagnostics.some(
        (diagnostic) => diagnostic.code === "malformed-source",
      ),
    ).toBe(true);
  });
});
