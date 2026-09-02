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
