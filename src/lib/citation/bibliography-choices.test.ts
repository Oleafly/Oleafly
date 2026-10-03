// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  declaredBibliographyFiles,
  preferredBibliography,
  rememberBibliography,
  rememberedBibliography,
} from "./bibliography-choices";

afterEach(() => localStorage.clear());

describe("declaredBibliographyFiles", () => {
  it("lists every Typst bibliography file in declaration order", () => {
    const main = [
      '#bibliography("primary.bib", target: selector(cite).before(<part2>))',
      "= Part two <part2>",
      '#bibliography(("secondary.bib", "data/extra.yml"), group: none)',
      '#bibliography("primary.bib")',
    ].join("\n");
    expect(
      declaredBibliographyFiles(
        "typst",
        [{ file: "main.typ", content: main }],
        ["primary.bib", "secondary.bib", "unused.bib"],
        ["data/extra.yml"],
      ),
    ).toEqual(["primary.bib", "secondary.bib", "data/extra.yml"]);
  });

  it("resolves Typst paths against the declaring file and skips missing files", () => {
    const chapter = '#bibliography("../refs/chapter.bib")\n#bibliography("missing.bib")';
    expect(
      declaredBibliographyFiles(
        "typst",
        [
          { file: "main.typ", content: '#bibliography("refs/main.bib")' },
          { file: "chapters/one.typ", content: chapter },
        ],
        ["refs/main.bib", "refs/chapter.bib"],
      ),
    ).toEqual(["refs/main.bib", "refs/chapter.bib"]);
  });

  it("ignores Typst declarations in comments", () => {
    const main = '// #bibliography("old.bib")\n#bibliography("new.bib")';
    expect(declaredBibliographyFiles("typst", [{ file: "main.typ", content: main }], ["old.bib", "new.bib"])).toEqual([
      "new.bib",
    ]);
  });

  it("lists LaTeX bibliography resources", () => {
    const main = [
      String.raw`\addbibresource{papers.bib}`,
      String.raw`% \addbibresource{commented.bib}`,
      String.raw`\bibliography{books,papers}`,
    ].join("\n");
    expect(
      declaredBibliographyFiles("latex", [{ file: "main.tex", content: main }], ["papers.bib", "books.bib", "commented.bib"]),
    ).toEqual(["papers.bib", "books.bib"]);
  });

  it("has nothing to offer for other profiles", () => {
    expect(declaredBibliographyFiles("markdown", [{ file: "main.md", content: "x" }], ["a.bib"])).toEqual([]);
  });
});

describe("remembered bibliography", () => {
  it("is stored per project", () => {
    expect(rememberedBibliography("p1")).toBeNull();
    rememberBibliography("p1", "secondary.bib");
    rememberBibliography("p2", "other.bib");
    expect(rememberedBibliography("p1")).toBe("secondary.bib");
    expect(rememberedBibliography("p2")).toBe("other.bib");
  });

  it("prefers the remembered file while it is still declared", () => {
    expect(preferredBibliography(["a.bib", "b.bib"], "b.bib")).toBe("b.bib");
    expect(preferredBibliography(["a.bib", "b.bib"], "gone.bib")).toBe("a.bib");
    expect(preferredBibliography(["a.bib"], null)).toBe("a.bib");
    expect(preferredBibliography([], "a.bib")).toBeNull();
  });
});
