import { describe, expect, it } from "vitest";
import { parseFile } from "./parse-file";

describe("parseFile: Typst", () => {
  it("parses headings and labels with exact spans and ignores comments", () => {
    const text = "= Introduction <intro>\n== Method\n// = Hidden <hidden>\n/* <also-hidden> */";
    const parsed = parseFile("main.typ", text);
    expect(parsed.defs.filter((s) => s.kind === "section").map((s) => [s.name, s.level])).toEqual([
      ["Introduction", 0],
      ["Method", 1],
    ]);
    const label = parsed.defs.find((s) => s.kind === "label");
    expect(label?.name).toBe("intro");
    expect(text.slice(label?.nameFrom, label?.nameTo)).toBe("intro");
  });

  it("models markup references including paired prose quotes", () => {
    const text = "See @intro and \"@quoted-markup\", but not #let hidden = \"@inside-code\".";
    const parsed = parseFile("main.typ", text);
    expect(parsed.uses.filter((s) => s.kind === "atuse").map((s) => s.name)).toEqual([
      "intro",
      "quoted-markup",
    ]);
  });

  it("parses local include/import edges and excludes package imports", () => {
    const text = '#include "chapters/intro.typ"\n#import "../shared.typ": note\n#import "@preview/cetz:0.3.4": canvas';
    const parsed = parseFile("book/main.typ", text);
    expect(parsed.uses.filter((s) => s.kind === "inputedge").map((s) => s.target)).toEqual([
      "book/chapters/intro.typ",
      "shared.typ",
    ]);
  });

  it("never applies LaTeX parsing rules to Typst source", () => {
    const parsed = parseFile("main.typ", "\\section{Wrong}\n\\label{wrong}\n= Right");
    expect(parsed.defs.map((s) => s.name)).toEqual(["Right"]);
  });

  it("keeps indexing after an unmatched prose measurement quote", () => {
    const text = '= Size\nA 12" display.\n= Later <later>\nSee @later.';
    const parsed = parseFile("main.typ", text);
    expect(parsed.defs.some((symbol) => symbol.name === "later")).toBe(true);
    expect(parsed.uses.some((symbol) => symbol.name === "later")).toBe(true);
  });

  it("masks code strings and resumes markup after a closed expression", () => {
    const text = '#text("@hidden") See @shown <shown> and "@paired". #text[@content]';
    const parsed = parseFile("main.typ", text);
    expect(parsed.uses.map((symbol) => symbol.name)).toEqual(["shown", "paired", "content"]);
    expect(parsed.defs.some((symbol) => symbol.name === "shown")).toBe(true);
  });

  it("does not treat email domains as references", () => {
    const parsed = parseFile("main.typ", "Email person@example.com or see @source.");
    expect(parsed.uses.map((symbol) => symbol.name)).toEqual(["source"]);
  });

  it("scans a long marker-heavy line without rescanning marker suffixes", () => {
    const parsed = parseFile("main.typ", `${"#".repeat(20_000)} @after`);
    expect(parsed.uses.map((symbol) => symbol.name)).toEqual(["after"]);
  });
});
