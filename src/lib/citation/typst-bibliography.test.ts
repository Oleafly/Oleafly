import { describe, expect, it } from "vitest";
import {
  hasTypstBibliography,
  typstBibliographyCalls,
  typstBibliographySources,
} from "./typst-bibliography";

describe("typstBibliographySources", () => {
  it.each([
    ['#bibliography("refs.bib")', ["refs.bib"]],
    ['#bibliography(("a.bib", "b.yml"))', ["a.bib", "b.yml"]],
    ['#bibliography(("a.bib", "b.yml",))', ["a.bib", "b.yml"]],
    ['#bibliography("refs.yml", title: "References", style: "ieee", full: true)', ["refs.yml"]],
    ['#bibliography(title: [Works (cited)], style: "apa", "refs.bib")', ["refs.bib"]],
    ['#bibliography(\n  (\n    "a.bib", // primary\n    "b.yaml",\n  ),\n  title: none,\n)', ["a.bib", "b.yaml"]],
    ['#bibliography("dir/r\\u{e9}fs.bib")', ["dir/réfs.bib"]],
    ['#show: paper.with(bibliography: bibliography("refs.bib"))', ["refs.bib"]],
  ])("reads %j", (source, expected) => {
    expect(typstBibliographySources(source)).toEqual(expected);
  });

  it("keeps the source order across calls", () => {
    expect(typstBibliographySources('#bibliography("one.yml")\n#bibliography("two.bib")')).toEqual([
      "one.yml",
      "two.bib",
    ]);
  });

  it("ignores commented, escaped and raw calls", () => {
    const source = [
      '// #bibliography("line.bib")',
      '/* #bibliography("block.bib") /* nested */ still */',
      '\\#bibliography("escaped.bib")',
      '`#bibliography("raw.bib")`',
      '```typ\n#bibliography("fenced.bib")\n```',
      'See https://example.com/x #bibliography("real.bib")',
    ].join("\n");
    expect(typstBibliographySources(source)).toEqual(["real.bib"]);
  });

  it("ignores computed paths, dictionaries and other functions", () => {
    expect(typstBibliographySources('#bibliography("a" + ".bib")')).toEqual([]);
    expect(typstBibliographySources('#bibliography(read("refs.bib", encoding: none))')).toEqual([]);
    expect(typstBibliographySources('#bibliography((path: "refs.bib"))')).toEqual([]);
    expect(typstBibliographySources('#my-bibliography("x.bib") #ref.bibliography("y.bib")')).toEqual([]);
  });

  it("reports offsets of each path inside its quotes", () => {
    const source = '#bibliography(("a.bib", "b.yml"))';
    const [call] = typstBibliographyCalls(source);
    expect(call.from).toBe(0);
    expect(call.to).toBe(source.length);
    expect(call.sources.map((item) => source.slice(item.from, item.to))).toEqual(["a.bib", "b.yml"]);
  });
});

describe("hasTypstBibliography", () => {
  it.each([
    '#bibliography("refs.bib")',
    '#bibliography(("a.bib", "b.yml"))',
    '#bibliography(\n  "refs.yml",\n  style: "apa",\n)',
    '#bibliography(read("refs.bib", encoding: none))',
  ])("finds a declaration in %j", (source) => {
    expect(hasTypstBibliography(source)).toBe(true);
  });

  it.each([
    "= Paper\n",
    '#set bibliography(style: "apa")\n',
    '#show bibliography: set text(9pt)\n',
    '// #bibliography("refs.bib")\n',
    "the bibliography(s) we read\n",
  ])("finds no declaration in %j", (source) => {
    expect(hasTypstBibliography(source)).toBe(false);
  });

  it("keeps scanning after prose that looks like a call", () => {
    expect(hasTypstBibliography('A bibliography(draft\n\n#bibliography("refs.bib")')).toBe(true);
  });
});
