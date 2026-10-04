import { describe, expect, it } from "vitest";
import {
  typstAtReferences,
  typstCiteCalls,
  typstHasBibliography,
  typstLabels,
  typstPackageImportNames,
  typstPathReferences,
  typstRefCalls,
  typstTemplateCalls,
} from "./typst-references";
import { scanTypst } from "./typst-scan";

describe("typstPackageImportNames", () => {
  it("reads plain names and aliases from package imports", () => {
    const scan = scanTypst('#import "@preview/cetz:0.3.4": canvas, draw as d, (plot)\n#import "@preview/fletcher:0.5.8":\tdiagram\t\tas\tfd\n');
    expect(typstPackageImportNames(scan)).toEqual(["canvas", "d", "plot", "fd"]);
  });

  it("skips entries that are not identifiers", () => {
    const scan = scanTypst(`#import "@preview/x:1.0.0": a b, as c, d as, ${"\t".repeat(5_000)}e\n`);
    expect(typstPackageImportNames(scan)).toEqual(["e"]);
  });
});

describe("typstPathReferences", () => {
  function references(text: string) {
    return typstPathReferences(scanTypst(text)).map(({ kind, raw }) => ({ kind, raw }));
  }

  it("collects images, data files, includes and bibliographies in source order", () => {
    expect(
      references(
        '#include "chapters/intro.typ"\n#image("fig/a.png")\n#let d = csv("data/x.csv")\n#import "lib.typ": f\n#bibliography("refs.bib")',
      ),
    ).toEqual([
      { kind: "include", raw: "chapters/intro.typ" },
      { kind: "image", raw: "fig/a.png" },
      { kind: "data", raw: "data/x.csv" },
      { kind: "include", raw: "lib.typ" },
      { kind: "bibliography", raw: "refs.bib" },
    ]);
  });

  it("reads every file of a bibliography given as an array, also through with", () => {
    expect(references('#bibliography(("a.bib", "b.yml"))')).toEqual([
      { kind: "bibliography", raw: "a.bib" },
      { kind: "bibliography", raw: "b.yml" },
    ]);
    expect(references('#show: bibliography.with("c.bib")')).toEqual([{ kind: "bibliography", raw: "c.bib" }]);
  });

  it("reads a bibliography file passed to a template by name", () => {
    const text = '#show: conf.with(bibliography-file: "refs/main.bib")';
    const [reference] = typstPathReferences(scanTypst(text));
    expect(reference).toMatchObject({ kind: "bibliography", raw: "refs/main.bib" });
    expect(text.slice(reference.from, reference.to)).toBe("refs/main.bib");
    expect(text.slice(reference.callFrom, reference.callTo)).toBe('bibliography-file: "refs/main.bib"');
  });

  it("skips calls whose path is computed, missing or external", () => {
    expect(
      references('#let p = "a.png"\n#image(p)\n#image(width: 50%)\n#image(("x.png", "y.png"))\n#import "@preview/cetz:0.3.4": canvas'),
    ).toEqual([]);
  });

  it("records the span of the whole call", () => {
    const text = '#image("a.png", width: 50%) after';
    const [reference] = typstPathReferences(scanTypst(text));
    expect(text.slice(reference.callFrom, reference.callTo)).toBe('image("a.png", width: 50%)');
  });
});

describe("typstTemplateCalls", () => {
  it("finds show rules, with-calls and calls to imported package functions", () => {
    const scan = scanTypst(
      '#import "@preview/charged-ieee:0.1.3": ieee\n#show: ieee.with(title: [A])\n#show: doc => conf(doc)\n#ieee(title: [B])',
    );
    expect(typstTemplateCalls(scan).map((call) => call.name)).toEqual(["ieee.with", "conf", "with", "ieee"]);
  });

  it("finds only show rules and with-calls when nothing is imported from a package", () => {
    expect(typstTemplateCalls(scanTypst("#ieee(title: [B])"))).toEqual([]);
  });
});

describe("typstHasBibliography", () => {
  it.each([
    ['#bibliography("refs.bib")', true],
    ['#show: bibliography.with("refs.bib")', true],
    ['#my-bibliography("refs.bib")', true],
    ['#show: conf.with(bibliography: bibliography("refs.bib"))', true],
    ['#show: conf.with(bibliography-file: "refs.bib")', true],
    ["#show: conf.with(bibliography: none)", false],
    ["A bibliography (in prose) is not code.", false],
  ])("reads %j as %s", (text, expected) => {
    expect(typstHasBibliography(scanTypst(text))).toBe(expected);
  });
});

describe("labels and references", () => {
  it("finds labels in markup but not inside comments or strings", () => {
    const text = '= Intro <sec:intro>\n// <hidden>\n#let s = "<quoted>"\nText <fig.a-1>';
    const labels = typstLabels(scanTypst(text));
    expect(labels.map((label) => label.name)).toEqual(["sec:intro", "fig.a-1"]);
    expect(text.slice(labels[0].from, labels[0].to)).toBe("<sec:intro>");
  });

  it("finds at-references and trims sentence punctuation", () => {
    const text = "See @fig:a. Also @sec:intro: and @eq-1, but not mail@example.com.";
    const references = typstAtReferences(scanTypst(text));
    expect(references.map((reference) => reference.name)).toEqual(["fig:a", "sec:intro", "eq-1"]);
    expect(text.slice(references[0].from, references[0].to)).toBe("@fig:a");
  });

  it("reads ref and cite targets written as labels or label calls", () => {
    const scan = scanTypst('#ref(<sec:a>) #ref(label("sec:b")) #cite(<knuth84>, supplement: [p. 3]) #cite(label("lamport94"))');
    expect(typstRefCalls(scan).map((use) => use.name)).toEqual(["sec:a", "sec:b"]);
    expect(typstCiteCalls(scan).map((use) => use.name)).toEqual(["knuth84", "lamport94"]);
  });

  it("ignores labels in content arguments, computed label calls and label calls outside the call", () => {
    const scan = scanTypst('#let k = "x"\n#cite(<a>, supplement: [see <b>]) #cite(label(k)) #label("loose") #cite(label(""))');
    expect(typstCiteCalls(scan).map((use) => use.name)).toEqual(["a"]);
  });

  it("spans the whole call for each target", () => {
    const text = "Before #ref(<sec:a>) after";
    const [use] = typstRefCalls(scanTypst(text));
    expect(text.slice(use.from, use.to)).toBe("ref(<sec:a>)");
  });
});
