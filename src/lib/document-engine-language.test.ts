import { describe, expect, it } from "vitest";
import {
  completionSyntaxForPath,
  formattingForPath,
  formattingProfileForPath,
  LATEX_ENGINE,
  sourceLanguageForPath,
  UNKNOWN_ENGINE,
} from "./document-engine";
import type { DocumentEngineDescriptor } from "./tauri";

function engineWithProfile(
  profile: "latex" | "typst" | "markdown",
  extensions: string[],
): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    source_extensions: extensions,
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: profile },
  };
}

const TYPST = engineWithProfile("typst", ["typ"]);
const MARKDOWN = engineWithProfile("markdown", ["md", "markdown"]);

describe("sourceLanguageForPath", () => {
  it.each([
    ["chapters/intro.typ", "typst"],
    ["MAIN.TYP", "typst"],
    ["main.tex", "latex"],
    ["notes/a.ltx", "latex"],
    ["paper.latex", "latex"],
    ["README.md", "markdown"],
    ["docs/guide.markdown", "markdown"],
  ] as const)("reads %s as %s", (path, language) => {
    expect(sourceLanguageForPath(path)).toBe(language);
  });

  it.each(["refs.bib", "style.sty", "Makefile", "dir.typ/notes", "constructor", null])(
    "knows no language for %s",
    (path) => {
      expect(sourceLanguageForPath(path)).toBeNull();
    },
  );
});

describe("completionSyntaxForPath", () => {
  it("follows the file rather than the project engine", () => {
    expect(completionSyntaxForPath("notes.typ", "latex")).toBe("typst");
    expect(completionSyntaxForPath("README.md", "typst")).toBe("markdown");
    expect(completionSyntaxForPath("appendix.tex", "typst")).toBe("latex");
    expect(completionSyntaxForPath("macros.sty", "typst")).toBe("latex");
    expect(completionSyntaxForPath("refs.bib", "typst")).toBe("bibtex");
  });

  it("falls back to the engine source format, then to generic", () => {
    expect(completionSyntaxForPath("report.rnw", "latex")).toBe("latex");
    expect(completionSyntaxForPath("notes.txt", "unknown")).toBe("generic");
    expect(completionSyntaxForPath(null, "unknown")).toBe("generic");
  });
});

describe("formattingProfileForPath", () => {
  it("follows the file rather than the project engine", () => {
    expect(formattingProfileForPath(LATEX_ENGINE, true, "notes.typ")).toBe("typst");
    expect(formattingProfileForPath(TYPST, true, "README.md")).toBe("markdown");
    expect(formattingProfileForPath(TYPST, true, "appendix.tex")).toBe("latex");
    expect(formattingProfileForPath(MARKDOWN, true, "chart.typ")).toBe("typst");
  });

  it("needs no engine for a known file language", () => {
    expect(formattingProfileForPath(UNKNOWN_ENGINE, false, "main.typ")).toBe("typst");
  });

  it("falls back to the engine for its own extra source extensions", () => {
    const custom = engineWithProfile("latex", ["tex", "rnw"]);
    expect(formattingProfileForPath(custom, true, "report.rnw")).toBe("latex");
    expect(formattingProfileForPath(custom, false, "report.rnw")).toBe("none");
    expect(formattingProfileForPath(LATEX_ENGINE, true, "refs.bib")).toBe("none");
    expect(formattingProfileForPath(LATEX_ENGINE, true, null)).toBe("none");
  });
});

describe("formattingForPath", () => {
  it("writes Typst markup for a Typst file in a LaTeX project", () => {
    expect(formattingForPath(LATEX_ENGINE, true, "notes.typ", "bold")).toEqual({
      kind: "wrap",
      before: "*",
      after: "*",
    });
    expect(formattingForPath(LATEX_ENGINE, true, "notes.typ", "section")).toEqual({
      kind: "insert",
      text: "= Heading\n",
    });
  });

  it("writes Markdown for a Markdown file in a Typst project", () => {
    expect(formattingForPath(TYPST, true, "README.md", "italic")).toEqual({
      kind: "wrap",
      before: "*",
      after: "*",
    });
  });

  it("writes LaTeX for a LaTeX file in a Typst project", () => {
    expect(formattingForPath(TYPST, true, "appendix.tex", "bold")).toEqual({
      kind: "wrap",
      before: String.raw`\textbf{`,
      after: "}",
    });
  });

  it("returns nothing for a file without a source language", () => {
    expect(formattingForPath(LATEX_ENGINE, true, "refs.bib", "bold")).toBeNull();
  });
});
