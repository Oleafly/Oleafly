import { describe, expect, it } from "vitest";
import { setTypstBibliographyStyle, typstBibliographyStyleValue } from "./typst-bibliography-style";

describe("typstBibliographyStyleValue", () => {
  it("reads the style of the first declaring bibliography call", () => {
    expect(typstBibliographyStyleValue('= Refs\n#bibliography("refs.bib", style: "apa")\n')).toBe("apa");
    expect(typstBibliographyStyleValue('#bibliography(("a.bib", "b.yml"), title: [Refs (all)], style: "ieee")')).toBe("ieee");
    expect(typstBibliographyStyleValue('#bibliography(\n  "refs.bib",\n  style: "/styles/journal.csl",\n)')).toBe(
      "/styles/journal.csl",
    );
  });

  it("tells a missing style apart from a missing bibliography", () => {
    expect(typstBibliographyStyleValue('#bibliography("refs.bib")')).toBeNull();
    expect(typstBibliographyStyleValue("No bibliography here.")).toBeUndefined();
    expect(typstBibliographyStyleValue('// #bibliography("refs.bib", style: "apa")')).toBeUndefined();
    expect(typstBibliographyStyleValue('#let s = "apa"\n#bibliography("refs.bib", style: s)')).toBeNull();
  });
});

describe("setTypstBibliographyStyle", () => {
  it("replaces an existing style argument in place", () => {
    expect(setTypstBibliographyStyle('#bibliography("refs.bib", style: "apa", title: none)', "ieee")).toBe(
      '#bibliography("refs.bib", style: "ieee", title: none)',
    );
    expect(setTypstBibliographyStyle('#let s = "apa"\n#bibliography("refs.bib", style: s)', "nature")).toBe(
      '#let s = "apa"\n#bibliography("refs.bib", style: "nature")',
    );
  });

  it("adds the style argument when the call has none", () => {
    expect(setTypstBibliographyStyle('Text.\n#bibliography("refs.bib")\n', "apa")).toBe(
      'Text.\n#bibliography("refs.bib", style: "apa")\n',
    );
    expect(setTypstBibliographyStyle('#bibliography(\n  "refs.bib",\n)', "apa")).toBe(
      '#bibliography(\n  "refs.bib", style: "apa",\n)',
    );
  });

  it("escapes the style name and leaves documents without a bibliography alone", () => {
    expect(setTypstBibliographyStyle('#bibliography("r.bib")', 'odd"name')).toBe(
      '#bibliography("r.bib", style: "odd\\"name")',
    );
    expect(setTypstBibliographyStyle("No bibliography.", "apa")).toBeNull();
  });

  it("only touches the bibliography call's own style argument", () => {
    const source = '#bibliography("refs.bib", title: text(style: "italic")[Refs])';
    expect(setTypstBibliographyStyle(source, "apa")).toBe(
      '#bibliography("refs.bib", title: text(style: "italic")[Refs], style: "apa")',
    );
    expect(typstBibliographyStyleValue(source)).toBeNull();
  });
});
