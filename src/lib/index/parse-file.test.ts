import { describe, it, expect } from "vitest";
import { parseFile } from "./parse-file";
import type { Sym } from "./types";
import { required } from "../test-utils";

const spanOk = (text: string, s: Sym) => text.slice(s.nameFrom, s.nameTo) === s.name;

function def(text: string, kind: string, name: string, path = "main.tex") {
  const r = parseFile(path, text);
  return r.defs.find((d) => d.kind === kind && d.name === name);
}
function use(text: string, kind: string, name: string, path = "main.tex") {
  const r = parseFile(path, text);
  return r.uses.find((u) => u.kind === kind && u.name === name);
}

describe("parseFile: definitions", () => {
  it("finds a \\label with an exact name span", () => {
    const t = "text \\label{fig:one} more";
    const d = required(def(t, "label", "fig:one"));
    expect(d).toBeDefined();
    expect(spanOk(t, d)).toBe(true);
  });

  it("finds \\newcommand macros (braced and unbraced) without the backslash", () => {
    expect(def("\\newcommand{\\foo}{x}", "macro", "foo")).toBeDefined();
    expect(def("\\newcommand\\bar{x}", "macro", "bar")).toBeDefined();
    expect(def("\\renewcommand{\\baz}{x}", "macro", "baz")).toBeDefined();
    const d = required(def("\\newcommand{\\foo}{x}", "macro", "foo"));
    expect("\\newcommand{\\foo}{x}".slice(d.nameFrom, d.nameTo)).toBe("foo");
  });

  it("finds \\def and \\DeclareMathOperator macros", () => {
    expect(def("\\def\\R{\\mathbb{R}}", "macro", "R")).toBeDefined();
    expect(def("\\DeclareMathOperator{\\argmax}{arg\\,max}", "macro", "argmax")).toBeDefined();
    expect(def("\\DeclareMathOperator*{\\Argmin}{arg min}", "macro", "Argmin")).toBeDefined();
  });

  it("finds \\newtheorem, \\newenvironment, and glossary entries", () => {
    expect(def("\\newtheorem{thm}{Theorem}", "theorem", "thm")).toBeDefined();
    expect(def("\\newenvironment{myenv}{a}{b}", "environment", "myenv")).toBeDefined();
    expect(def("\\newglossaryentry{gpu}{name=GPU}", "glossary", "gpu")).toBeDefined();
    expect(def("\\newacronym{ml}{ML}{Machine Learning}", "glossary", "ml")).toBeDefined();
  });

  it("finds sections with a level and title", () => {
    const d = required(def("\\section{Introduction}", "section", "Introduction"));
    expect(d).toBeDefined();
    expect(d.level).toBe(2);
    expect(def("\\subsection{Background}", "section", "Background")?.level).toBe(3);
  });

  it("captures a section title with nested braces whole (exact name span)", () => {
    const t = "\\section{Intro to \\texttt{foo}} body";
    const d = required(def(t, "section", "Intro to \\texttt{foo}"));
    expect(d).toBeDefined();
    expect(spanOk(t, d)).toBe(true);
    // A following symbol still parses (scanning resumed past the whole title).
    const t2 = "\\section{A \\texttt{x}}\n\\label{sec:a}";
    expect(def(t2, "section", "A \\texttt{x}")).toBeDefined();
    expect(def(t2, "label", "sec:a")).toBeDefined();
  });

  it("parses only bib entries from a .bib file", () => {
    const t = "@article{smith21,\n title={X}\n}\n@book{jones19, title={Y}}";
    const r = parseFile("refs.bib", t);
    expect(r.defs.filter((d) => d.kind === "bibentry").map((d) => d.name).sort()).toEqual(["jones19", "smith21"]);
    expect(r.defs.some((d) => d.kind === "label")).toBe(false);
  });

  it("skips @comment/@string in .bib", () => {
    const r = parseFile("r.bib", "@string{x = {y}}\n@article{real, title={Z}}");
    expect(r.defs.filter((d) => d.kind === "bibentry").map((d) => d.name)).toEqual(["real"]);
  });

  it("treats \\bibitem as a bib entry (inline bibliographies)", () => {
    expect(def("\\bibitem{knuth84}", "bibentry", "knuth84")).toBeDefined();
    expect(def("\\bibitem[KL]{lamport86}", "bibentry", "lamport86")).toBeDefined();
  });
});

describe("parseFile: uses", () => {
  it("finds \\ref and \\eqref uses", () => {
    expect(use("see \\ref{fig:one}", "ref", "fig:one")).toBeDefined();
    expect(use("\\eqref{eq:2}", "ref", "eq:2")).toBeDefined();
  });

  it("splits multi-label \\cref into one use per label with correct spans", () => {
    const t = "\\cref{a,b}";
    const r = parseFile("m.tex", t);
    const refs = r.uses.filter((u) => u.kind === "ref");
    expect(refs.map((u) => u.name).sort()).toEqual(["a", "b"]);
    for (const u of refs) expect(spanOk(t, u)).toBe(true);
  });

  it("finds \\cite uses and splits multiple keys, ignoring the optional arg", () => {
    const t = "\\citep[p.~5]{smith21,jones19}";
    const r = parseFile("m.tex", t);
    expect(r.uses.filter((u) => u.kind === "cite").map((u) => u.name).sort()).toEqual(["jones19", "smith21"]);
  });

  it("finds glossary uses, \\begin environments, and \\input edges", () => {
    expect(use("\\gls{gpu}", "glossaryuse", "gpu")).toBeDefined();
    expect(use("\\begin{thm}", "envuse", "thm")).toBeDefined();
    const e = required(use("\\input{sections/intro}", "inputedge", "sections/intro", "main.tex"));
    expect(e).toBeDefined();
    expect(e.target).toBe("sections/intro.tex");
  });
});

describe("parseFile: comments", () => {
  it("ignores commands inside comments", () => {
    expect(def("% \\label{ignored}\n\\label{real}", "label", "ignored")).toBeUndefined();
    expect(def("% \\label{ignored}\n\\label{real}", "label", "real")).toBeDefined();
  });
  it("does not treat an escaped \\% as a comment", () => {
    expect(use("50\\% done \\ref{r}", "ref", "r")).toBeDefined();
  });
});
