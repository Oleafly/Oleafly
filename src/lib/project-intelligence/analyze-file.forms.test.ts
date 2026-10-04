import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import type { FileAnalysis } from "./types";

function definitionsByName(analysis: FileAnalysis) {
  return new Map(analysis.definitions.map((definition) => [definition.name, definition]));
}

function usesOf(analysis: FileAnalysis, kind: string) {
  return analysis.uses
    .filter((use) => use.kind === kind)
    .map((use) => [use.name, use.target ?? null]);
}

function edgeTargets(analysis: FileAnalysis) {
  return analysis.edges.map((edge) => [edge.kind, edge.rawTarget, edge.targetFile]);
}

describe("LaTeX command and environment definitions", () => {
  const analysis = analyzeProjectFile(
    "macros.sty",
    String.raw`
\NewDocumentCommand{\every}{s t+ R(){x} D<>{d} r[] d|| e{^_} E{_^}{{a}{b}} +m !o >{\SplitList{;}}m b v O{z} t\foo d{<}{>}}{}
\NewDocumentCommand{\bare}{}{}
\NewDocumentCommand{\unknowntype}{q}{}
\NewDocumentCommand{\nobody}{m}
\NewDocumentCommand{\nospec}
\NewDocumentCommand\nobraces{m}{}
\NewDocumentCommand{}{m}{}
\NewDocumentEnvironment{fancy}{t* D(){1}}{}{}
\NewDocumentEnvironment{badspec}{q}{}{}
\NewDocumentEnvironment{halfenv}{m}{}
\NewDocumentEnvironment{}{m}{}{}
\newcommand\plain{x}
\newcommand{\two words}{x}
\newcommand{\nobody}
\newenvironment{bad name}{}{}
\newenvironment{}{}{}
\newenvironment{halfclassic}{}
\newenvironment{counted}[2]{}{}
\DeclareMathOperator{\Tr}{Tr}
\DeclareMathOperator*{\argmax}{arg\,max}
\def\nogroup#1 text
`,
    1,
  );
  const byName = definitionsByName(analysis);

  it("reads every xparse argument type into counts and a completion snippet", () => {
    expect(byName.get("every")?.latexArguments).toEqual({
      syntax: "xparse",
      requiredCount: 6,
      optionalCount: 10,
      xparseSpecification: String.raw`s t+ R(){x} D<>{d} r[] d|| e{^_} E{_^}{{a}{b}} +m !o >{\SplitList{;}}m b v O{z} t\foo d{<}{>}`,
      completionSnippet:
        `\${1}\${2}(\${3})<\${4}>[\${5}]|\${6}|\${7}\${8}{\${9}}[\${10}]{\${11}}{\${12}}{\${13}}[\${14:z}]\${15}<\${16}>`,
    });
    expect(byName.get("every")?.detail).toContain("xparse · s t+");
  });

  it("describes a command without arguments", () => {
    expect(byName.get("bare")).toMatchObject({
      detail: "xparse · no arguments",
      latexArguments: { requiredCount: 0, optionalCount: 0, completionSnippet: "" },
    });
  });

  it("skips declarations with an invalid specification, no body or no braced name", () => {
    for (const name of ["unknowntype", "nobody", "nospec", "nobraces", "badspec", "halfenv", "two words", "two", "bad name", "halfclassic", "nogroup"]) {
      expect(byName.has(name), name).toBe(false);
    }
    expect(byName.has("")).toBe(false);
  });

  it("reads xparse and classic environments", () => {
    expect(byName.get("fancy")).toMatchObject({
      kind: "environment",
      latexArguments: { syntax: "xparse", optionalCount: 2, completionSnippet: `\${1}(\${2})` },
    });
    expect(byName.get("counted")).toMatchObject({
      kind: "environment",
      latexArguments: { syntax: "classic", requiredCount: 2, completionSnippet: `{\${1}}{\${2}}` },
    });
  });

  it("reads unbraced classic macros and math operators", () => {
    expect(byName.get("plain")).toMatchObject({ kind: "macro", latexArguments: { syntax: "classic", requiredCount: 0 } });
    expect(byName.get("Tr")).toMatchObject({ kind: "macro", detail: "math operator" });
    expect(byName.get("argmax")).toMatchObject({ kind: "macro", detail: "math operator" });
    const source = analysis.definitions.find((definition) => definition.name === "argmax");
    expect(source?.location.range.to).toBeGreaterThan(source?.location.range.from ?? 0);
  });
});

describe("LaTeX file, import, asset and link uses", () => {
  const analysis = analyzeProjectFile(
    "chapters/main.tex",
    String.raw`\subfile{parts/one}
\InputIfFileExists{config}
\import{figures/}{plot}
\subimport*{../shared//}{macros}
\includesvg[width=2cm]{art/logo}
\inputminted[linenos]{python}{code/run.py}
\href{#sec:local}{here}
\href{other.tex#sec:far}{there}
\url{}
\url{https://example.org}
\verbatiminput{/abs/file.txt}`,
    1,
  );

  it("records subfile and conditional inputs as include edges", () => {
    expect(usesOf(analysis, "include")).toEqual([
      ["parts/one", "chapters/parts/one"],
      ["config", "chapters/config"],
    ]);
  });

  it("joins import directories and file names", () => {
    expect(usesOf(analysis, "import")).toEqual([
      ["figures/plot", "chapters/figures/plot"],
      ["../shared/macros", "shared/macros"],
    ]);
  });

  it("records SVG, minted and verbatim assets, keeping unresolvable targets", () => {
    expect(usesOf(analysis, "asset")).toEqual([
      ["art/logo", "chapters/art/logo"],
      ["/abs/file.txt", null],
      ["code/run.py", "chapters/code/run.py"],
    ]);
  });

  it("splits link anchors into references and skips empty or external-only links", () => {
    expect(usesOf(analysis, "reference")).toEqual([
      ["sec:local", null],
      ["sec:far", "chapters/other.tex#sec:far"],
    ]);
    expect(usesOf(analysis, "link")).toEqual([
      ["other.tex#sec:far", "chapters/other.tex"],
      ["https://example.org", null],
    ]);
    expect(edgeTargets(analysis).filter(([kind]) => kind === "link")).toEqual([
      ["link", "other.tex#sec:far", "chapters/other.tex"],
      ["link", "https://example.org", null],
    ]);
  });
});

describe("Markdown structure", () => {
  it("reads a front-matter bibliography list until the next key", () => {
    const analysis = analyzeProjectFile(
      "notes/paper.md",
      ["---", "title: Paper", "bibliography:", "  - refs.bib", "  - 'extra.bib'", "", "author: Me", "  - not-a-bib.bib", "---", "Body"].join("\n"),
      1,
    );
    expect(usesOf(analysis, "bibliography").map(([name]) => name)).toEqual(["refs.bib", "extra.bib"]);
    expect(analysis.status).toBe("success");
  });

  it("reports unclosed front matter and fences as partial analysis", () => {
    const frontMatter = analyzeProjectFile("a.md", "---\ntitle: x\n", 1);
    expect(frontMatter.status).toBe("partial");
    expect(frontMatter.diagnostics.map((diagnostic) => diagnostic.message.key)).toEqual(["unclosedFrontMatter"]);

    const fence = analyzeProjectFile("b.md", "# Title\n\n````js\n[x][y]\n```\nstill code", 1);
    expect(fence.status).toBe("partial");
    expect(fence.diagnostics.map((diagnostic) => diagnostic.message.key)).toEqual(["unclosedFence"]);
    expect(usesOf(fence, "reference")).toEqual([]);
  });

  it("ignores links inside closed fences and inline code but reads reference links outside", () => {
    const source = [
      "~~~",
      "[hidden][ref]",
      "```",
      "~~~~",
      "Inline `[code][ref]` and [Shown][Target] plus [Collapsed][].",
      "",
      "[target]: https://example.org",
      "[collapsed]: other.md",
    ].join("\n");
    const analysis = analyzeProjectFile("c.md", source, 1);
    expect(usesOf(analysis, "reference")).toEqual(
      expect.arrayContaining([
        ["target", null],
        ["collapsed", null],
      ]),
    );
    expect(usesOf(analysis, "reference").some(([name]) => name === "ref")).toBe(false);
    const target = analysis.uses.find((use) => use.kind === "reference" && use.name === "target");
    expect(source.slice(target?.location.range.from, target?.location.range.to)).toBe("Target");
    expect(analysis.status).toBe("success");
  });

  it("records include directives from common Markdown preprocessors", () => {
    const analysis = analyzeProjectFile(
      "book/index.md",
      ["!include chapters/one.md", "{{< include 'two.md' >}}", '{% include "three.md" %}'].join("\n"),
      1,
    );
    expect(usesOf(analysis, "include")).toEqual([
      ["chapters/one.md", "book/chapters/one.md"],
      ["two.md", "book/two.md"],
      ["three.md", "book/three.md"],
    ]);
    expect(analysis.edges.map((edge) => edge.kind)).toEqual(["include", "include", "include"]);
  });
});

describe("Typst bibliography, asset and link uses", () => {
  it("records bibliography sources, assets and project links", () => {
    const analysis = analyzeProjectFile(
      "doc/main.typ",
      [
        '#bibliography(("refs.bib", "more.yml"))',
        '#image("figures/plot.png")',
        '#csv("data/table.csv")',
        '#link("appendix.typ")[Appendix]',
        '// #image("commented.png")',
      ].join("\n"),
      1,
    );
    expect(usesOf(analysis, "bibliography").map(([name]) => name)).toEqual(["refs.bib", "more.yml"]);
    expect(usesOf(analysis, "asset")).toEqual([
      ["figures/plot.png", "doc/figures/plot.png"],
      ["data/table.csv", "doc/data/table.csv"],
    ]);
    expect(usesOf(analysis, "link")).toEqual([["appendix.typ", "doc/appendix.typ"]]);
  });
});

describe("unsupported files", () => {
  it("refuses files no engine can analyze", () => {
    expect(() => analyzeProjectFile("image.png", "", 1)).toThrow("Unsupported project-intelligence file: image.png");
  });
});

describe("malformed source diagnostics", () => {
  const keys = (analysis: FileAnalysis) => analysis.diagnostics.map((diagnostic) => [diagnostic.message.key, diagnostic.message.params ?? null]);

  it("reports a stray closing brace in LaTeX but not an escaped one", () => {
    const analysis = analyzeProjectFile("main.tex", String.raw`a \} b } c`, 1);
    expect(analysis.status).toBe("partial");
    expect(keys(analysis)).toEqual([["unexpectedClosingDelimiter", { char: "}" }]]);
    expect(analysis.diagnostics[0].location.range.from).toBe(7);
  });

  it("reports mismatched Typst delimiters and an unclosed string", () => {
    const mismatched = analyzeProjectFile("a.typ", "#f(a]", 1);
    expect(keys(mismatched)).toEqual([
      ["unexpectedClosingDelimiter", { char: "]" }],
      ["unclosedDelimiter", { char: "(", expected: ")" }],
    ]);
    const unclosed = analyzeProjectFile("b.typ", '#let x = "open \\" quote', 1);
    expect(keys(unclosed)).toEqual([["unclosedString", null]]);
    expect(unclosed.status).toBe("partial");
  });

  it("accepts Typst strings and comments that contain delimiters", () => {
    const analysis = analyzeProjectFile(
      "c.typ",
      ['#let s = "(not [code] /* x */"', "/* outer /* inner */ still ( */", '#let t = "say \\"hi\\""', "// trailing ) comment"].join("\n"),
      1,
    );
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.status).toBe("success");
  });

  it("reports an unclosed Typst block comment", () => {
    const analysis = analyzeProjectFile("d.typ", "text /* open /* nested */", 1);
    expect(analysis.status).toBe("partial");
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.message.key)).toContain("unclosedTypstComment");
  });
});

describe("LaTeX citation key forms", () => {
  const citations = (source: string) =>
    analyzeProjectFile("main.tex", source, 1)
      .uses.filter((use) => use.kind === "citation")
      .map((use) => [use.name, source.slice(use.location.range.from, use.location.range.to)]);

  it("trims keys, skips the nocite wildcard and reads every volcites key", () => {
    expect(citations(String.raw`\cite{ alpha , beta }`)).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
    expect(citations(String.raw`\nocite{*}`)).toEqual([]);
    expect(citations(String.raw`\volcites{1}{alpha}{2}{beta}`)).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
  });

  it("skips comments inside a key list, including CRLF line ends and a comment closing the group", () => {
    expect(citations("\\cite{alpha,% first\r\nbeta,% last}\n}")).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
  });

  it("collects thebibliography items as bibliography entries", () => {
    const analysis = analyzeProjectFile(
      "main.tex",
      String.raw`\begin{thebibliography}{9}
\bibitem{knuth} D. Knuth. The TeXbook.
\end{thebibliography}`,
      1,
    );
    expect(analysis.bibliographyEntries).toEqual([
      expect.objectContaining({ key: "knuth", type: "bibitem", file: "main.tex", fields: [], complete: true }),
    ]);
  });
});
