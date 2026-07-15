import { describe, it, expect } from "vitest";
import { buildIndex } from "./build";

describe("buildIndex: macrouse second pass", () => {
  it("links \\foo uses to the \\newcommand def and excludes the def site", () => {
    const idx = buildIndex({ "main.tex": "\\newcommand{\\foo}{x}\nUse \\foo here and \\foo again." });
    const uses = idx.uses.filter((u) => u.kind === "macrouse" && u.name === "foo");
    expect(uses).toHaveLength(2);
  });

  it("does not flag \\foobar as a use of \\foo (word boundary)", () => {
    const idx = buildIndex({ "m.tex": "\\newcommand{\\foo}{x}\n\\foobar" });
    expect(idx.uses.some((u) => u.kind === "macrouse" && u.name === "foo")).toBe(false);
  });

  it("finds macro uses in other files", () => {
    const idx = buildIndex({
      "macros.tex": "\\newcommand{\\R}{\\mathbb{R}}",
      "body.tex": "the set \\R is nice",
    });
    const u = idx.uses.find((x) => x.kind === "macrouse" && x.name === "R");
    expect(u?.file).toBe("body.tex");
  });
});

describe("buildIndex: symbolAt + definitionFor", () => {
  const idx = buildIndex({
    "main.tex": "\\label{fig:1}\nSee \\ref{fig:1}.\n\\cite{smith21}",
    "refs.bib": "@article{smith21, title={X}}",
  });

  it("returns the token under an offset", () => {
    const text = "\\label{fig:1}\nSee \\ref{fig:1}.\n\\cite{smith21}";
    const refOffset = text.indexOf("\\ref{fig:1}") + 2;
    const sym = idx.symbolAt("main.tex", refOffset);
    expect(sym?.kind).toBe("ref");
    expect(sym?.name).toBe("fig:1");
  });

  it("resolves a ref to its label definition", () => {
    const ref = idx.uses.find((u) => u.kind === "ref" && u.name === "fig:1")!;
    const d = idx.definitionFor(ref);
    expect(d?.kind).toBe("label");
    expect(d?.file).toBe("main.tex");
  });

  it("resolves a cite to its bib entry", () => {
    const cite = idx.uses.find((u) => u.kind === "cite" && u.name === "smith21")!;
    const d = idx.definitionFor(cite);
    expect(d?.kind).toBe("bibentry");
    expect(d?.file).toBe("refs.bib");
  });

  it("returns null for an unresolved ref", () => {
    const i2 = buildIndex({ "m.tex": "\\ref{ghost}" });
    const ref = i2.uses.find((u) => u.kind === "ref")!;
    expect(i2.definitionFor(ref)).toBeNull();
  });
});

describe("buildIndex: Typst graph and ambiguous links", () => {
  it("resolves local includes and @labels without pretending every @key is a citation", () => {
    const idx = buildIndex({
      "main.typ": '= Main <main>\n#include "chapter.typ"\nSee @chapter.',
      "chapter.typ": "== Chapter <chapter>",
    });
    const edge = idx.uses.find((u) => u.kind === "inputedge")!;
    expect(idx.definitionFor(edge)?.file).toBe("chapter.typ");
    const link = idx.uses.find((u) => u.kind === "atuse")!;
    expect(idx.definitionFor(link)).toMatchObject({ kind: "label", name: "chapter" });
    expect(idx.references("chapter", "atuse")).toHaveLength(1);
  });
});

describe("buildIndex: references", () => {
  it("lists every use of a label", () => {
    const idx = buildIndex({ "m.tex": "\\label{a}\n\\ref{a} \\cref{a,b} \\eqref{a}" });
    expect(idx.references("a", "ref")).toHaveLength(3);
  });
});

describe("buildIndex: renamePlan", () => {
  it("edits the label def and all refs across files", () => {
    const idx = buildIndex({
      "main.tex": "\\label{old}\ntext",
      "body.tex": "see \\ref{old} and \\cref{old,x}",
    });
    const def = idx.defs.find((d) => d.kind === "label" && d.name === "old")!;
    const plan = idx.renamePlan(def, "new");
    expect(plan.collision).toBe(false);
    // 1 def + 2 refs (\ref and the "old" in \cref) = 3 edits across 2 files.
    expect(plan.edits).toHaveLength(3);
    expect(plan.fileCount).toBe(2);
    for (const e of plan.edits) expect(e.newText).toBe("new");
  });

  it("renames a macro at its def and every use", () => {
    const idx = buildIndex({ "m.tex": "\\newcommand{\\foo}{x}\n\\foo and \\foo" });
    const def = idx.defs.find((d) => d.kind === "macro" && d.name === "foo")!;
    const plan = idx.renamePlan(def, "bar");
    expect(plan.edits).toHaveLength(3); // def + 2 uses
  });

  it("detects a collision with an existing same-kind def", () => {
    const idx = buildIndex({ "m.tex": "\\label{a}\n\\label{b}" });
    const def = idx.defs.find((d) => d.kind === "label" && d.name === "a")!;
    expect(idx.renamePlan(def, "b").collision).toBe(true);
  });

  it("resolves a use to its def before planning (rename from a use site)", () => {
    const idx = buildIndex({ "m.tex": "\\label{a}\n\\ref{a}" });
    const use = idx.uses.find((u) => u.kind === "ref" && u.name === "a")!;
    const plan = idx.renamePlan(use, "z");
    expect(plan.edits).toHaveLength(2); // def + the ref
  });
});
