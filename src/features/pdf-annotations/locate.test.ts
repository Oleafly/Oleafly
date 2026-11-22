import { describe, expect, it, vi } from "vitest";
import { chooseSource, locateSource, regionProbePoints, sourceOfQuote } from "./locate";

const text = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");

describe("locateSource", () => {
  it("spans the lines between both ends of a selection in one file", async () => {
    const lineAt = vi
      .fn()
      .mockResolvedValueOnce({ path: "main.tex", line: 9 })
      .mockResolvedValueOnce({ path: "main.tex", line: 7 });
    const source = await locateSource(
      { page: 1, x: 10, y: 20 },
      { page: 1, x: 90, y: 40 },
      null,
      lineAt,
      () => text,
    );
    expect(lineAt).toHaveBeenNthCalledWith(1, 1, 10, 20, null);
    expect(lineAt).toHaveBeenNthCalledWith(2, 1, 90, 40, null);
    expect(source).toEqual({ path: "main.tex", startLine: 7, endLine: 9, excerpt: "line 7\nline 8\nline 9" });
  });

  it("stays in the first file when the ends land in different files", async () => {
    const lineAt = vi
      .fn()
      .mockResolvedValueOnce({ path: "a.tex", line: 5 })
      .mockResolvedValueOnce({ path: "b.tex", line: 1 });
    const source = await locateSource({ page: 1, x: 0, y: 0 }, { page: 2, x: 0, y: 0 }, null, lineAt, () => text);
    expect(source).toEqual({ path: "a.tex", startLine: 5, endLine: 5, excerpt: "line 5" });
  });

  it("uses whichever end resolves, and keeps the place without the text", async () => {
    const lineAt = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ path: "b.tex", line: 4 });
    const source = await locateSource({ page: 1, x: 0, y: 0 }, { page: 1, x: 0, y: 0 }, null, lineAt, () => null);
    expect(source).toEqual({ path: "b.tex", startLine: 4, endLine: 4, excerpt: "" });
  });

  it("gives up without a file", async () => {
    const lineAt = vi.fn().mockResolvedValue({ path: null, line: 3 });
    expect(await locateSource({ page: 1, x: 0, y: 0 }, { page: 1, x: 0, y: 0 }, null, lineAt, () => text)).toBeNull();
    lineAt.mockResolvedValue(null);
    expect(await locateSource({ page: 1, x: 0, y: 0 }, { page: 1, x: 0, y: 0 }, null, lineAt, () => text)).toBeNull();
  });
});

describe("regionProbePoints", () => {
  it("probes the middle of a box's top and bottom edges, just inside", () => {
    expect(regionProbePoints({ page: 4, x: 100, y: 200, width: 50, height: 40 })).toEqual([
      { page: 4, x: 125, y: 202 },
      { page: 4, x: 125, y: 238 },
    ]);
  });
});

describe("sourceOfQuote", () => {
  const main = [
    "\\documentclass{article}",
    "\\usepackage{minted}",
    "\\title{Shell commands repro}",
    "\\begin{document}",
    "This project needs LaTeX shell commands. It compiles only when external",
    "commands are allowed for this project.",
    "\\section*{Highlighted code}",
    "\\begin{minted}{python}",
    "def greet(name):",
    "    return f\"Hello, {name}!\"",
    "\\end{minted}",
    "\\end{document}",
  ].join("\n");

  it("finds a code block from the text inside a region, across its lines", () => {
    const quote = { text: "def greet(name):\nreturn f\"Hello, {name}!\"", before: "Highlighted code", after: "" };
    expect(sourceOfQuote(quote, { "notes.tex": "nothing like it", "main.tex": main })).toEqual({
      path: "main.tex",
      startLine: 9,
      endLine: 10,
      excerpt: "def greet(name):\n    return f\"Hello, {name}!\"",
    });
  });

  it("finds prose through markup and a line break in the source", () => {
    const quote = { text: "LaTeX shell commands. It compiles only when external commands are allowed", before: "", after: "" };
    expect(sourceOfQuote(quote, { "main.tex": main })).toMatchObject({ startLine: 5, endLine: 6 });
    const marked = { text: "Highlighted code", before: "", after: "" };
    expect(sourceOfQuote(marked, { "main.tex": main })).toMatchObject({ startLine: 7, endLine: 7 });
  });

  it("uses the words around a short selection to pick the right line", () => {
    const quote = { text: "this", before: "commands are allowed for ", after: " project." };
    expect(sourceOfQuote(quote, { "main.tex": main })).toMatchObject({ path: "main.tex", startLine: 6, endLine: 6 });
  });

  it("gives up when the text is not in any source", () => {
    expect(sourceOfQuote({ text: "a figure caption nowhere in the files", before: "", after: "" }, { "main.tex": main })).toBeNull();
    expect(sourceOfQuote({ text: "", before: "", after: "" }, { "main.tex": main })).toBeNull();
  });
});

describe("chooseSource", () => {
  const texts = () => ({ "main.tex": "\\section{Code}\ndef greet(name):\n    return name\n" });
  const code = { text: "def greet(name):\nreturn name", before: "", after: "" };
  const heading = { path: "main.tex", startLine: 1, endLine: 1, excerpt: "\\section{Code}" };

  it("keeps what SyncTeX found for a text selection", () => {
    expect(chooseSource({ text: "Code", before: "", after: "" }, heading, false, texts)).toBe(heading);
  });

  it("looks up a region's text when SyncTeX found nothing or lines without that text", () => {
    expect(chooseSource(code, null, true, texts)).toMatchObject({ startLine: 2, endLine: 3 });
    expect(chooseSource(code, heading, true, texts)).toMatchObject({ startLine: 2, endLine: 3 });
  });

  it("falls back to SyncTeX, or nothing, when the text is not in the sources", () => {
    const figure = { text: "", before: "", after: "" };
    expect(chooseSource(figure, heading, true, texts)).toBe(heading);
    expect(chooseSource({ text: "not in any file at all", before: "", after: "" }, null, true, texts)).toBeNull();
  });
});
