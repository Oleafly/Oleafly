import { describe, expect, it } from "vitest";
import { snippetLanguageForPath } from "./language";

describe("snippetLanguageForPath", () => {
  it("maps paths to snippet languages", () => {
    expect(snippetLanguageForPath("a/B.TEX")).toBe("latex");
    expect(snippetLanguageForPath("doc.latex")).toBe("latex");
    expect(snippetLanguageForPath("x.typ")).toBe("typst");
    expect(snippetLanguageForPath("x.markdown")).toBe("markdown");
    expect(snippetLanguageForPath("x.bib")).toBe("bibtex");
    expect(snippetLanguageForPath("x.py")).toBeNull();
    expect(snippetLanguageForPath(null)).toBeNull();
  });
});
