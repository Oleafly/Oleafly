import { describe, expect, it } from "vitest";
import { typstPackageImportNames } from "./typst-references";
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
