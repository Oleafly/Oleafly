import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { languageForPath } from "./languages";

describe("languageForPath", () => {
  it.each([
    "main.tex",
    "main.ltx",
    "main.latex",
    "package.sty",
    "document.cls",
    "notes.md",
    "notes.markdown",
    "main.typ",
    "references.bib",
  ])("loads contractual source support for %s case-insensitively", (path) => {
    expect(languageForPath(path)).not.toBeNull();
    expect(languageForPath(`chapters/${path.toUpperCase()}`)).not.toBeNull();
  });

  it.each([
    "main.typ.txt",
    "main.tex.txt",
    "notes.markdown.bak",
    "plain.bst",
    "PLAIN.BST",
  ])("does not grant contractual support to excluded/lookalike path %s", (path) => {
    expect(languageForPath(path)).toBeNull();
  });

  it("gives a BibTeX buffer its comment token and closing brackets", () => {
    const support = languageForPath("references.bib");
    expect(support).not.toBeNull();
    const state = EditorState.create({
      doc: "@article{a,\n  title = {T},\n}",
      extensions: [support!],
    });
    expect(
      state.languageDataAt<{ line: string }>("commentTokens", 1)[0]?.line,
    ).toBe("%");
    expect(
      state.languageDataAt<{ brackets: string[] }>("closeBrackets", 1)[0]
        ?.brackets,
    ).toEqual(["{", '"', "("]);
  });

  it("routes a lookalike with a real generic suffix to that suffix only", () => {
    expect(languageForPath("references.bib.json")?.language.name).toBe(
      "json",
    );
    expect(languageForPath("main.tex.json")?.language.name).toBe("json");
  });
});
