import { describe, expect, it } from "vitest";
import { parseFile } from "./parse-file";
import { maskTypstSource, typstRawEnd } from "./parse-typst";

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

  it("resolves import targets by the extension of the last segment", () => {
    const targets = (source: string) =>
      parseFile("dir/main.typ", source)
        .uses.filter((symbol) => symbol.kind === "inputedge")
        .map((symbol) => symbol.target);
    expect(targets('#include "child"')).toEqual(["dir/child.typ"]);
    expect(targets('#include "child.typ"')).toEqual(["dir/child.typ"]);
    expect(targets('#include "a.b.c"')).toEqual(["dir/a.b.c"]);
    expect(targets('#include "v1.0/child"')).toEqual(["dir/v1.0/child.typ"]);
    expect(targets('#include "child."')).toEqual(["dir/child..typ"]);
  });
});

describe("parseFile: Typst links, escapes and Unicode names", () => {
  it("keeps URLs in headings and the label that follows them", () => {
    const parsed = parseFile(
      "main.typ",
      "= Zdroje z https://typst.app/docs#intro <zdroje>\nViz @zdroje.\n",
    );
    expect(parsed.defs.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "section:Zdroje z https://typst.app/docs#intro",
      "label:zdroje",
    ]);
    expect(parsed.uses.map((s) => s.name)).toEqual(["zdroje"]);
  });

  it("indexes Unicode labels and trims sentence punctuation from references", () => {
    const text = "= Úvod <kap:úvod>\nViz @kap:úvod. a @введение: <введение>\n";
    const parsed = parseFile("main.typ", text);
    expect(parsed.defs.filter((s) => s.kind === "label").map((s) => s.name)).toEqual([
      "kap:úvod",
      "введение",
    ]);
    const uses = parsed.uses.filter((s) => s.kind === "atuse");
    expect(uses.map((s) => text.slice(s.from, s.to))).toEqual(["@kap:úvod", "@введение"]);
  });

  it("ignores escaped at signs and at signs inside URLs", () => {
    const parsed = parseFile(
      "main.typ",
      "jan\\@firma.cz https://example.org/@autor \\<ne> \\\\@ano\n",
    );
    expect(parsed.uses.map((s) => s.name)).toEqual(["ano"]);
    expect(parsed.defs).toEqual([]);
  });
});

describe("parseFile: Typst comments and code masking", () => {
  it("masks nested and multi-line block comments and keeps line numbers", () => {
    const text = "/* outer /* inner <a> */ still <b> */\n/* first\n<c>\nlast */ <d>\n// trailing <e>";
    const parsed = parseFile("main.typ", text);
    expect(parsed.defs.map((s) => [s.name, s.line])).toEqual([["d", 4]]);
  });

  it("keeps nested brackets inside content blocks", () => {
    const text = "#figure[x [y] <inner> @a] <outer>";
    const parsed = parseFile("main.typ", text);
    expect(parsed.defs.map((s) => s.name)).toEqual(["inner", "outer"]);
    expect(parsed.uses.map((s) => s.name)).toEqual(["a"]);
  });

  it("masks escaped quotes and escaped line breaks inside code strings", () => {
    const text = '#let s = "say \\"@hidden\\" ok"\n#let t = "a\\\n@also"\nSee @shown.';
    const parsed = parseFile("main.typ", text);
    expect(parsed.uses.map((s) => [s.name, s.line])).toEqual([["shown", 4]]);
  });

  it("masks strings in code blocks and reads content blocks inside them", () => {
    const text = '#{ let x = "@hidden"; [@inside] } @after';
    const parsed = parseFile("main.typ", text);
    expect(parsed.uses.map((s) => s.name)).toEqual(["inside", "after"]);
  });

  it("normalises dotted import path segments and adds the extension", () => {
    const text = '#import "./parts/./intro.typ": x\n#include "notes"\n#include "/abs.typ"';
    const parsed = parseFile("book/main.typ", text);
    expect(parsed.uses.filter((s) => s.kind === "inputedge").map((s) => s.target)).toEqual([
      "book/parts/intro.typ",
      "book/notes.typ",
    ]);
  });

  it("keeps a double slash inside a code string out of comment masking", () => {
    const text = '#let s = "x // y"\nSee @first.\n#import "./parts//intro.typ": x\nSee @after <here>.\n#let n = 1 // @gone';
    const parsed = parseFile("book/main.typ", text);
    expect(parsed.uses.map((s) => [s.kind, s.name, s.line])).toEqual([
      ["atuse", "first", 2],
      ["atuse", "after", 4],
      ["inputedge", "./parts//intro.typ", 3],
    ]);
    expect(parsed.uses.find((s) => s.kind === "inputedge")?.target).toBe("book/parts/intro.typ");
    expect(parsed.defs.map((s) => s.name)).toEqual(["here"]);
  });

  it("ignores references, labels, headings and imports inside raw text", () => {
    const text = [
      "= Intro <intro>",
      "Inline `@nokey <nolabel>` raw, `` then @intro.",
      "```typ",
      "= Not a heading",
      '#import "fenced.typ" @fenced <fencedlabel> // "',
      "```",
      "#let r = `@code <codelabel>` + \"`\"",
      "@after",
    ].join("\n");
    const parsed = parseFile("main.typ", text);
    expect(parsed.defs.map((s) => [s.kind, s.name])).toEqual([
      ["section", "Intro"],
      ["label", "intro"],
    ]);
    expect(parsed.uses.map((s) => [s.kind, s.name, s.line])).toEqual([
      ["atuse", "intro", 2],
      ["atuse", "after", 8],
    ]);
  });

  it("blanks comments and raw text but keeps URLs, code strings and line breaks", () => {
    const source = 'a // line\nhttps://x.org/p // tail\n/* one /* two */\nstill */ b\n#f("x // y") `r // s` ```\nz\n``` c';
    const masked = maskTypstSource(source);
    expect(masked.text).toHaveLength(source.length);
    expect(masked.text.split("\n")).toEqual([
      `a${" ".repeat(8)}`,
      `https://x.org/p${" ".repeat(8)}`,
      " ".repeat(16),
      `${" ".repeat(9)}b`,
      `#f("x // y")${" ".repeat(13)}`,
      " ",
      `${" ".repeat(3)} c`,
    ]);
    expect(masked.code.split("\n")[4]).toBe(`#f(${" ".repeat(8)})${" ".repeat(13)}`);
  });

  it("closes raw text at the first fence of its own width and reads `` as empty raw", () => {
    expect(typstRawEnd("`a``b`", 0)).toBe(3);
    expect(typstRawEnd("`` @x", 0)).toBe(2);
    expect(typstRawEnd("```a````b", 0)).toBe(7);
    expect(typstRawEnd("```open", 0)).toBe(3);
  });

  it("keeps indexing after a raw fence that never closes", () => {
    const parsed = parseFile("main.typ", "Typing `code @first\n<here>");
    expect(parsed.uses.map((s) => s.name)).toEqual(["first"]);
    expect(parsed.defs.map((s) => s.name)).toEqual(["here"]);
  });

  it("skips a heading marker with no title", () => {
    const parsed = parseFile("main.typ", "=   \n= Real");
    expect(parsed.defs.map((s) => s.name)).toEqual(["Real"]);
  });
});
