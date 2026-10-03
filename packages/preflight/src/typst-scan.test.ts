import { describe, expect, it } from "vitest";
import {
  isBlankValue,
  namedArgument,
  positionalArgument,
  resolveTypstPath,
  scanTypst,
  stringValue,
  typstCalls,
  typstMethodCalls,
  typstVersionAtLeast,
} from "./typst-scan";

describe("scanTypst", () => {
  it("keeps offsets and blanks comments and raw text", () => {
    const text = "Text // TODO hidden\n/* block /* nested */ still */ after `raw TODO` end";
    const scan = scanTypst(text);
    expect(scan.masked).toHaveLength(text.length);
    expect(scan.masked).not.toContain("TODO");
    expect(scan.masked).toContain("after");
    expect(scan.comments.map((range) => text.slice(range.from, range.to))).toEqual([
      "// TODO hidden",
      "/* block /* nested */ still */",
    ]);
  });

  it("keeps a URL in markup out of the comment scanner", () => {
    const scan = scanTypst("See https://example.com/a@b for more.");
    expect(scan.comments).toEqual([]);
    expect(scan.markup).not.toContain("@b");
  });

  it("separates code from markup", () => {
    const text = '#image("a.png", alt: "Plot") and #emph[see @fig] here';
    const scan = scanTypst(text);
    expect(scan.code).toContain("image(");
    expect(scan.code).not.toContain("Plot");
    expect(scan.markup).toContain("see @fig");
    expect(scan.markup).toContain("here");
    expect(scan.markup).not.toContain("image");
  });

  it("treats line statements as code until the end of the line", () => {
    const scan = scanTypst('#set document(title: "A")\n= Intro\n#let x = 1\nBody');
    expect(scan.markup).toContain("= Intro");
    expect(scan.markup).toContain("Body");
    expect(scan.markup).not.toContain("document");
    expect(scan.markup).not.toContain("let");
  });

  it("returns to markup after a call so a trailing label is markup", () => {
    const scan = scanTypst("#figure(image(\"a.png\"))<fig:a> after");
    expect(scan.markup).toContain("<fig:a>");
  });

  it("does not mistake a quotation in markup for a string", () => {
    const scan = scanTypst('He said "see @fig:a" today.');
    expect(scan.markup).toContain("@fig:a");
  });

  it("keeps a content block inside a multi-line show rule as markup", () => {
    const text = "#show: ieee.with(\n  title: [A (title],\n  abstract: [Text],\n)\nBody";
    const scan = scanTypst(text);
    const [call] = typstMethodCalls(scan, "with");
    expect(call.args.map((arg) => arg.name)).toEqual(["title", "abstract"]);
    expect(scan.markup).toContain("Body");
  });
});

describe("typstCalls", () => {
  it("reads positional and named arguments with string values", () => {
    const scan = scanTypst('#figure(image("plots/a.png", width: 50%), caption: [A], alt: "")');
    const image = typstCalls(scan, ["image"])[0];
    const path = positionalArgument(scan, image);
    expect(path && stringValue(scan, path.valueFrom, path.valueTo)?.value).toBe("plots/a.png");
    const figure = typstCalls(scan, ["figure"])[0];
    const alt = namedArgument(figure, "alt");
    expect(alt && isBlankValue(scan, alt.valueFrom, alt.valueTo)).toBe(true);
    expect(namedArgument(figure, "caption")).toBeDefined();
  });

  it("finds calls to hyphenated names", () => {
    const scan = scanTypst("#show-equation(x)\n#great-theorems-init(y)");
    expect(typstCalls(scan, ["show-equation", "great-theorems-init"]).map((call) => call.name)).toEqual([
      "show-equation",
      "great-theorems-init",
    ]);
  });

  it("ignores a word in markup that looks like a call", () => {
    expect(typstCalls(scanTypst("The image (left) shows it."), ["image"])).toEqual([]);
  });
});

describe("typstVersionAtLeast", () => {
  it("compares release numbers", () => {
    expect(typstVersionAtLeast("0.14.0", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast("0.13.1", [0, 14, 0])).toBe(false);
    expect(typstVersionAtLeast("0.15.1", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast("1.0.0-rc.1", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast(undefined, [0, 14, 0])).toBe(true);
  });
});

describe("resolveTypstPath", () => {
  it("resolves against the file and treats a leading slash as the project root", () => {
    expect(resolveTypstPath("chapters/intro.typ", "fig/a.png")).toBe("chapters/fig/a.png");
    expect(resolveTypstPath("chapters/intro.typ", "../fig/a.png")).toBe("fig/a.png");
    expect(resolveTypstPath("chapters/intro.typ", "/fig/a.png")).toBe("fig/a.png");
    expect(resolveTypstPath("main.typ", "@preview/cetz:0.3.0")).toBeNull();
    expect(resolveTypstPath("main.typ", "../outside.png")).toBeNull();
  });
});
