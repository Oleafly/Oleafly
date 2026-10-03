import { describe, expect, it } from "vitest";
import {
  ensureMarkdownBibliography,
  ensureTypstBibliography,
  markdownBibliographyPaths,
  selectCitationBibliography,
} from "./citation";

describe("Typst bibliography wiring", () => {
  it("adds the official bibliography declaration exactly once", () => {
    const once = ensureTypstBibliography("= Paper\n", "references.bib");
    expect(once).toContain('#bibliography("references.bib")');
    expect(ensureTypstBibliography(once, "other.bib")).toBe(once);
  });

  it.each([
    '#bibliography(("a.bib", "b.yml"))\n',
    '#bibliography(\n  "refs.yml",\n  title: [References],\n  style: "apa",\n)\n',
    '#bibliography("refs.bib", full: true)\n',
    '#show: paper.with(bibliography: bibliography("refs.bib"))\n',
  ])("does not add a second call next to %j", (source) => {
    expect(ensureTypstBibliography(`= Paper\n\n${source}`, "other.bib")).toBe(`= Paper\n\n${source}`);
  });

  it("adds a declaration when the only call is commented out or a set rule", () => {
    for (const source of ['// #bibliography("old.bib")\n', '#set bibliography(style: "apa")\n']) {
      expect(ensureTypstBibliography(source, "refs.yml")).toBe(`${source.trimEnd()}\n\n#bibliography("refs.yml")\n`);
    }
  });

  it.each([
    ['#bibliography(("a.yml", "b.bib"))', ["c.bib", "b.bib"], "b.bib"],
    ['#bibliography(title: "References", "refs.bib", style: "ieee")', ["References.bib", "refs.bib"], "refs.bib"],
    ['#bibliography(\n  (\n    "lib/a.bib",\n    "lib/b.bib",\n  ),\n)', ["lib/b.bib", "lib/a.bib"], "lib/a.bib"],
  ])("writes BibTeX to the first declared .bib in %j", (source, bibs, expected) => {
    expect(selectCitationBibliography("typst", source, bibs, "main.typ", "references.bib", ["a.yml"])).toBe(expected);
  });

  it("targets the first declared Hayagriva file when no .bib is declared", () => {
    const source = '#bibliography(("one.yaml", "two.yml"), style: "apa")';
    expect(selectCitationBibliography("typst", source, ["other.bib"], "main.typ", "references.bib", ["two.yml", "one.yaml"]))
      .toBe("one.yaml");
    expect(selectCitationBibliography("typst", '#bibliography("refs.yml")', ["other.bib"], "chapters/main.typ", "references.bib", []))
      .toBe("chapters/refs.yml");
  });

  it("keeps BibTeX-only callers on .bib files", () => {
    expect(selectCitationBibliography("typst", '#bibliography("refs.yml")', ["other.bib"])).toBe("other.bib");
    expect(selectCitationBibliography("typst", '#bibliography("refs.yml")', [])).toBe("references.bib");
  });
});

describe("Markdown bibliography wiring", () => {
  it("creates YAML metadata exactly once", () => {
    const once = ensureMarkdownBibliography("# Paper\n", "references.bib");
    expect(once).toBe('---\nbibliography: "references.bib"\n---\n\n# Paper\n');
    expect(ensureMarkdownBibliography(once, "other.bib")).toBe(once);
  });

  it("adds bibliography to existing front matter without replacing metadata", () => {
    const source = "---\ntitle: Paper\n---\n\nText\n";
    expect(ensureMarkdownBibliography(source, "refs/library.bib")).toBe(
      '---\ntitle: Paper\nbibliography: "refs/library.bib"\n---\n\nText\n',
    );
  });

  it("writes citations to the bibliography already declared by front matter", () => {
    const source = '---\ntitle: Paper\nbibliography: "refs/library.bib"\n---\n\nText\n';
    expect(markdownBibliographyPaths(source)).toEqual(["refs/library.bib"]);
    expect(
      selectCitationBibliography("markdown", source, ["a-first.bib", "refs/library.bib"]),
    ).toBe("refs/library.bib");
  });

  it("supports a YAML bibliography list", () => {
    const source = "---\nbibliography:\n  - 'refs/primary.bib'\n  - refs/secondary.bib\n---\n";
    expect(markdownBibliographyPaths(source)).toEqual([
      "refs/primary.bib",
      "refs/secondary.bib",
    ]);
    expect(
      selectCitationBibliography("markdown", source, ["other.bib", "refs/primary.bib"]),
    ).toBe("refs/primary.bib");
  });

  it("supports an indentationless YAML bibliography list", () => {
    const source = "---\nbibliography:\n- a.bib\n- b.bib\n---\n";
    expect(markdownBibliographyPaths(source)).toEqual(["a.bib", "b.bib"]);
  });
});
