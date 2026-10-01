import { describe, it, expect } from "vitest";
import { buildIndex, indexFromSymbols } from "./build";
import type { Sym } from "./types";
import { required } from "../test-utils";

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

  it("reads Unicode macro names whole when linking uses", () => {
    const idx = buildIndex({ "m.tex": "\\newcommand{\\foo}{x}\n\\fooé \\foo é\n\\newcommand{\\výsledek}{42}\n\\výsledek" });
    const names = idx.uses.filter((u) => u.kind === "macrouse").map((u) => u.name);
    expect(names).toEqual(["foo", "výsledek"]);
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
    const ref = required(idx.uses.find((u) => u.kind === "ref" && u.name === "fig:1"));
    const d = idx.definitionFor(ref);
    expect(d?.kind).toBe("label");
    expect(d?.file).toBe("main.tex");
  });

  it("resolves a cite to its bib entry", () => {
    const cite = required(idx.uses.find((u) => u.kind === "cite" && u.name === "smith21"));
    const d = idx.definitionFor(cite);
    expect(d?.kind).toBe("bibentry");
    expect(d?.file).toBe("refs.bib");
  });

  it("returns null for an unresolved ref", () => {
    const i2 = buildIndex({ "m.tex": "\\ref{ghost}" });
    const ref = required(i2.uses.find((u) => u.kind === "ref"));
    expect(i2.definitionFor(ref)).toBeNull();
  });
});

describe("buildIndex: Typst graph and ambiguous links", () => {
  it("resolves local includes and @labels without pretending every @key is a citation", () => {
    const idx = buildIndex({
      "main.typ": '= Main <main>\n#include "chapter.typ"\nSee @chapter.',
      "chapter.typ": "== Chapter <chapter>",
    });
    const edge = required(idx.uses.find((u) => u.kind === "inputedge"));
    expect(idx.definitionFor(edge)?.file).toBe("chapter.typ");
    const link = required(idx.uses.find((u) => u.kind === "atuse"));
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
    const def = required(idx.defs.find((d) => d.kind === "label" && d.name === "old"));
    const plan = idx.renamePlan(def, "new");
    expect(plan.collision).toBe(false);
    // 1 def + 2 refs (\ref and the "old" in \cref) = 3 edits across 2 files.
    expect(plan.edits).toHaveLength(3);
    expect(plan.fileCount).toBe(2);
    for (const e of plan.edits) expect(e.newText).toBe("new");
  });

  it("renames a macro at its def and every use", () => {
    const idx = buildIndex({ "m.tex": "\\newcommand{\\foo}{x}\n\\foo and \\foo" });
    const def = required(idx.defs.find((d) => d.kind === "macro" && d.name === "foo"));
    const plan = idx.renamePlan(def, "bar");
    expect(plan.edits).toHaveLength(3); // def + 2 uses
  });

  it("detects a collision with an existing same-kind def", () => {
    const idx = buildIndex({ "m.tex": "\\label{a}\n\\label{b}" });
    const def = required(idx.defs.find((d) => d.kind === "label" && d.name === "a"));
    expect(idx.renamePlan(def, "b").collision).toBe(true);
  });

  it("resolves a use to its def before planning (rename from a use site)", () => {
    const idx = buildIndex({ "m.tex": "\\label{a}\n\\ref{a}" });
    const use = required(idx.uses.find((u) => u.kind === "ref" && u.name === "a"));
    const plan = idx.renamePlan(use, "z");
    expect(plan.edits).toHaveLength(2); // def + the ref
  });
});

describe("indexFromSymbols: Markdown links and anchors", () => {
  const sym = (
    kind: Sym["kind"],
    name: string,
    file: string,
    from: number,
    target?: string,
  ): Sym => ({
    kind,
    name,
    file,
    line: 1,
    from,
    to: from + name.length,
    nameFrom: from,
    nameTo: from + name.length,
    ...(target ? { target } : {}),
  });
  const idx = indexFromSymbols(
    [
      // A second LaTeX file defines the same label first; the link names
      // paper.tex, so it must still land there.
      sym("label", "sec:results", "chapter.tex", 0),
      sym("label", "sec:results", "paper.tex", 10),
      sym("label", "sec:results", "other.md", 0),
      sym("label", "sec:results", "third.md", 0),
    ],
    [
      sym("ref", "sec:results", "paper.tex", 40),
      sym("ref", "sec:results", "notes.md", 20, "paper.tex#sec:results"),
      sym("ref", "sec:results", "other.md", 30),
      sym("ref", "sec:results", "notes.md", 60, "other.md#sec:results"),
    ],
  );
  const def = (file: string) =>
    required(idx.defs.find((d) => d.kind === "label" && d.file === file));
  const use = (file: string, from: number) =>
    required(idx.uses.find((u) => u.file === file && u.from === from));

  it("resolves a file#anchor link to the label in that file", () => {
    expect(idx.definitionFor(use("notes.md", 20))).toBe(def("paper.tex"));
    expect(idx.definitionFor(use("notes.md", 60))).toBe(def("other.md"));
  });

  it("renames a LaTeX label together with a Markdown link to it", () => {
    const plan = idx.renamePlan(def("paper.tex"), "sec:new");
    expect(plan.edits.map((edit) => `${edit.file}@${edit.from}`)).toEqual([
      "notes.md@20",
      "paper.tex@40",
      "paper.tex@10",
    ]);
    expect(idx.allReferences(def("paper.tex")).map((s) => s.file)).toEqual([
      "paper.tex",
      "paper.tex",
      "notes.md",
    ]);
  });

  it("keeps a Markdown anchor to its own file", () => {
    const plan = idx.renamePlan(def("other.md"), "sec:new");
    expect(plan.edits.map((edit) => `${edit.file}@${edit.from}`)).toEqual([
      "notes.md@60",
      "other.md@30",
      "other.md@0",
    ]);
    expect(idx.definitionFor(use("other.md", 30))).toBe(def("other.md"));
    // third.md has its own anchor of that name, which is not a clash.
    expect(idx.renamePlan(def("other.md"), "sec:results").collision).toBe(false);
  });
});

describe("buildIndex: LaTeX and Typst labels stay apart", () => {
  // A LaTeX and a Typst document that reuse label names, plus one citation
  // key that both of them read from the same .bib file.
  const idx = buildIndex({
    "paper.tex": "\\label{eq:mae}\nSee \\eqref{eq:mae} and \\cite{alpha}.",
    "paper.typ": "$ x $ <eq:mae>\n= Other <eq:rmse>\nSee @eq:mae and @alpha.",
    "refs.bib": "@misc{alpha, title={Alpha}}",
  });
  const latexLabel = required(
    idx.defs.find((d) => d.kind === "label" && d.name === "eq:mae" && d.file === "paper.tex"),
  );

  it("renames a LaTeX label without touching the Typst label or reference", () => {
    const plan = idx.renamePlan(latexLabel, "eq:new");
    expect(plan.edits.map((edit) => edit.file)).toEqual(["paper.tex", "paper.tex"]);
    expect(plan.fileCount).toBe(1);
  });

  it("does not call a name only Typst uses a collision for a LaTeX label", () => {
    expect(idx.renamePlan(latexLabel, "eq:rmse").collision).toBe(false);
  });

  it("resolves and renames a Typst reference against the Typst label", () => {
    const use = required(idx.uses.find((u) => u.kind === "atuse" && u.name === "eq:mae"));
    expect(idx.definitionFor(use)?.file).toBe("paper.typ");
    const plan = idx.renamePlan(use, "eq:new");
    expect(new Set(plan.edits.map((edit) => edit.file))).toEqual(new Set(["paper.typ"]));
    expect(plan.edits).toHaveLength(2);
  });

  it("lists only same-engine references for a label", () => {
    expect(idx.allReferences(latexLabel).map((sym) => sym.file)).toEqual([
      "paper.tex",
      "paper.tex",
    ]);
  });

  it("still renames a citation key everywhere it is cited", () => {
    const entry = required(idx.defs.find((d) => d.kind === "bibentry" && d.name === "alpha"));
    const plan = idx.renamePlan(entry, "beta");
    expect(new Set(plan.edits.map((edit) => edit.file))).toEqual(
      new Set(["refs.bib", "paper.tex", "paper.typ"]),
    );
  });
});
