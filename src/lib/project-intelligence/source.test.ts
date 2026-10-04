import { describe, expect, it } from "vitest";
import {
  analysisEngineForPath,
  engineForPath,
  isBibliographyYamlCandidate,
  isProjectIntelligencePath,
  lineStarts,
  location,
  maskLatexComments,
  normalizeProjectPath,
  rangeFromOffsets,
  resolveProjectPath,
  sourceHash,
  stableId,
  trimRange,
} from "./source";

describe("project paths", () => {
  it.each([
    ["chapters/intro.tex", "chapters/intro.tex"],
    ["chapters\\intro.tex", "chapters/intro.tex"],
    ["./a//b/./c.tex", "a/b/c.tex"],
    ["a/b/../c.tex", "a/c.tex"],
    ["../outside.tex", null],
    ["/abs/path.tex", null],
    ["C:/Users/x.tex", null],
    ["a\u0007b.tex", null],
    ["bad\u007f.tex", null],
    ["", null],
    ["./", null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeProjectPath(input)).toBe(expected);
  });

  it.each([
    ["chapters/main.tex", "intro", ".tex", "chapters/intro.tex"],
    ["main.tex", "./figures/plot", ".tex", "figures/plot.tex"],
    ["main.tex", "'refs.bib'", ".bib", "refs.bib"],
    ["main.tex", "data.csv", ".tex", "data.csv"],
    ["main.tex", "intro", undefined, "intro"],
    ["main.tex", "  ", ".tex", null],
    ["main.tex", "#anchor", ".tex", null],
    ["main.tex", "@preview/pkg", ".typ", null],
    ["main.tex", "/root.tex", ".tex", null],
    ["main.tex", "https://example.org/x", ".tex", null],
    ["main.tex", "../../escape", ".tex", null],
  ])("resolves %j -> %j", (from, target, extension, expected) => {
    expect(resolveProjectPath(from, target, extension)).toBe(expected);
  });

  it("classifies source files by engine", () => {
    expect(engineForPath("refs.BIB")).toBe("bibtex");
    expect(engineForPath("main.typ")).toBe("typst");
    expect(engineForPath("notes.md")).toBe("markdown");
    expect(engineForPath("notes.markdown")).toBe("markdown");
    expect(engineForPath("style.sty")).toBe("latex");
    expect(engineForPath("refs.yml")).toBeNull();
    expect(analysisEngineForPath("refs.yml")).toBe("bibtex");
    expect(analysisEngineForPath("figure.png")).toBeNull();
  });

  it("recognises bibliography YAML candidates but not hidden or lock files", () => {
    expect(isBibliographyYamlCandidate("refs.yml")).toBe(true);
    expect(isBibliographyYamlCandidate("bib\\works.yaml")).toBe(true);
    expect(isBibliographyYamlCandidate(".github/workflows/ci.yml")).toBe(false);
    expect(isBibliographyYamlCandidate("pnpm-lock.yaml")).toBe(false);
    expect(isBibliographyYamlCandidate("main.tex")).toBe(false);
    expect(isProjectIntelligencePath("refs.yml")).toBe(true);
    expect(isProjectIntelligencePath("main.tex")).toBe(true);
    expect(isProjectIntelligencePath("figure.png")).toBe(false);
  });
});

describe("ranges and ids", () => {
  const text = "ab\ncd\n\nef";
  const starts = lineStarts(text);

  it("maps offsets to 1-based lines and 0-based columns", () => {
    expect(starts).toEqual([0, 3, 6, 7]);
    expect(rangeFromOffsets(starts, 4, 8)).toEqual({ from: 4, to: 8, startLine: 2, startColumn: 1, endLine: 4, endColumn: 1 });
    expect(rangeFromOffsets(starts, -3, -5)).toEqual({ from: 0, to: 0, startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 });
    expect(location("main.tex", starts, 6, 6)).toEqual({
      file: "main.tex",
      range: { from: 6, to: 6, startLine: 3, startColumn: 0, endLine: 3, endColumn: 0 },
    });
  });

  it("builds stable encoded ids and hashes", () => {
    expect(stableId("def", "a b", 3, "x:y")).toBe("def:a%20b:3:x%3Ay");
    expect(sourceHash("")).toBe("811c9dc5");
    expect(sourceHash("abc")).toBe(sourceHash("abc"));
    expect(sourceHash("abc")).not.toBe(sourceHash("abd"));
    expect(sourceHash("abc")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("trims whitespace from both ends of a range", () => {
    expect(trimRange("  word \n", 0, 8)).toEqual([2, 6]);
    expect(trimRange("   ", 0, 3)).toEqual([3, 3]);
  });
});

describe("comment masking", () => {
  it("blanks LaTeX comments but keeps escaped percent signs and line breaks", () => {
    const source = "a % note\n50\\% off % gone\n\\\\% after a line break\nend";
    const masked = maskLatexComments(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toEqual([
      `a${" ".repeat(7)}`,
      `50\\% off${" ".repeat(7)}`,
      `\\\\${" ".repeat(20)}`,
      "end",
    ]);
  });
});
