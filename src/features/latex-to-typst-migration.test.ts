import { describe, expect, it, vi } from "vitest";
import type { AdHocConversionRequest, CompileResult, CreateAdHocProjectRequest } from "@/lib/tauri";
import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import {
  applyBibliographyStyle,
  carrySharedDefinitions,
  fixBlockReferences,
  fixEquationAliases,
  fixCrossReferences,
  fixImagePaths,
  fixUnconvertedMath,
  numberLabelledEquations,
  pandocReportNotes,
  prepareLatexProject,
  relativeTypstPath,
  runLatexToTypstMigration,
  splitConvertedIncludes,
  type MigrationDeps,
} from "./latex-to-typst-migration";

const MAIN = [
  String.raw`\documentclass{article}`,
  String.raw`\input{macros}`,
  String.raw`\graphicspath{{figures/}}`,
  String.raw`\begin{document}`,
  String.raw`\section{Intro}`,
  String.raw`Hello \R.`,
  String.raw`\include{chapters/one}`,
  String.raw`\begin{figure}`,
  String.raw`\input{figures/table}`,
  String.raw`\end{figure}`,
  String.raw`Text \input{inline} more.`,
  String.raw`\input{missing}`,
  String.raw`% \input{commented}`,
  String.raw`\bibliographystyle{IEEEtran}`,
  String.raw`\end{document}`,
].join("\n");

const TEXTS = new Map([
  ["main.tex", MAIN],
  ["macros.tex", String.raw`\newcommand{\R}{\mathbb{R}}`],
  ["chapters/one.tex", [String.raw`\section{One}`, String.raw`\input{chapters/sub}`, ""].join("\n")],
  ["chapters/sub.tex", "Sub text."],
  ["figures/table.tex", String.raw`\begin{tabular}{l}x\end{tabular}`],
  ["inline.tex", "INLINE"],
]);

function lineOf(text: string, needle: string): number {
  return text.split("\n").findIndex((line) => line.includes(needle));
}

describe("prepareLatexProject", () => {
  const prepared = prepareLatexProject("main.tex", TEXTS);

  it("inlines preamble inputs and inputs inside environments", () => {
    expect(prepared.text).toContain(String.raw`\newcommand{\R}{\mathbb{R}}`);
    expect(prepared.text).not.toContain(String.raw`\input{macros}`);
    expect(prepared.text).toContain([String.raw`\begin{figure}`, String.raw`\begin{tabular}{l}x\end{tabular}`].join("\n"));
    expect(prepared.text).toContain("Text INLINE more.");
  });

  it("marks top level includes so they can become separate Typst files", () => {
    expect(prepared.includes).toEqual([
      expect.objectContaining({ id: 0, source: "chapters/one.tex", target: "chapters/one.typ", kind: "include" }),
      expect.objectContaining({ id: 1, source: "chapters/sub.tex", target: "chapters/sub.typ", kind: "input" }),
    ]);
    const order = ["OLEAFLYINCLUDEBEGIN0", "OLEAFLYINCLUDEBEGIN1", "OLEAFLYINCLUDEEND1", "OLEAFLYINCLUDEEND0"].map((marker) =>
      prepared.text.indexOf(marker),
    );
    expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]))).toBe(true);
    expect(prepared.text).toContain("\n\nOLEAFLYINCLUDEBEGIN0\n\n");
  });

  it("keeps where every line came from", () => {
    expect(prepared.origins[lineOf(prepared.text, String.raw`\newcommand`)]).toEqual({ file: "macros.tex", line: 1 });
    expect(prepared.origins[lineOf(prepared.text, "Hello")]).toEqual({ file: "main.tex", line: 6 });
    expect(prepared.origins[lineOf(prepared.text, "Sub text.")]).toEqual({ file: "chapters/sub.tex", line: 1 });
    expect(prepared.origins[lineOf(prepared.text, "OLEAFLYINCLUDEBEGIN0")]).toEqual({ file: "main.tex", line: 7 });
    expect(prepared.origins).toHaveLength(prepared.text.split("\n").length);
  });

  it("reports missing inputs, graphics paths and the bibliography style", () => {
    expect(prepared.missing).toEqual([{ name: "missing", origin: { file: "main.tex", line: 12 } }]);
    expect(prepared.text).toContain(String.raw`\input{missing}`);
    expect(prepared.text).toContain(String.raw`% \input{commented}`);
    expect(prepared.graphicsPaths).toEqual(["figures/"]);
    expect(prepared.bibliographyStyle).toBe("IEEEtran");
  });

  it("maps files below the main document's folder to the new project root", () => {
    const nested = prepareLatexProject(
      "paper/main.tex",
      new Map([
        ["paper/main.tex", [String.raw`\begin{document}`, String.raw`\include{parts/a}`, String.raw`\end{document}`].join("\n")],
        ["paper/parts/a.tex", "A"],
      ]),
    );
    expect(nested.includes).toEqual([expect.objectContaining({ source: "paper/parts/a.tex", target: "parts/a.typ" })]);
  });

  it("keeps only the document body of a subfile", () => {
    const subfiles = prepareLatexProject(
      "main.tex",
      new Map([
        ["main.tex", [String.raw`\begin{document}`, String.raw`\subfile{ch}`, String.raw`\end{document}`].join("\n")],
        [
          "ch.tex",
          [String.raw`\documentclass[main]{subfiles}`, String.raw`\begin{document}`, "Body", String.raw`\end{document}`].join("\n"),
        ],
      ]),
    );
    expect(subfiles.text).toContain("Body");
    expect(subfiles.text).not.toContain("subfiles");
    expect(subfiles.origins[lineOf(subfiles.text, "Body")]).toEqual({ file: "ch.tex", line: 3 });
  });

  it("stops at a cycle of inputs", () => {
    const cycle = prepareLatexProject(
      "main.tex",
      new Map([
        ["main.tex", [String.raw`\begin{document}`, String.raw`\input{a}`, String.raw`\end{document}`].join("\n")],
        ["a.tex", String.raw`\input{a}`],
      ]),
    );
    expect(cycle.includes.length).toBeLessThan(10);
  });
});

describe("prepareLatexProject structure", () => {
  const prepared = prepareLatexProject(
    "main.tex",
    new Map([
      [
        "main.tex",
        [
          String.raw`\begin{document}`,
          String.raw`\tableofcontents`,
          String.raw`\begin{table*}[t]`,
          String.raw`\caption{Wide}\label{tab:wide}`,
          String.raw`\end{table*}`,
          String.raw`\begin{align}`,
          String.raw`a &= b \label{eq:first}\\`,
          String.raw`c &= d \label{eq:second}`,
          String.raw`\end{align}`,
          String.raw`\appendix`,
          String.raw`\end{document}`,
        ].join("\n"),
      ],
    ]),
  );

  it("keeps Typst placeholders for structure Pandoc drops", () => {
    expect(prepared.raw).toEqual(["#outline()", '#counter(heading).update(0)\n#set heading(numbering: "A.1")']);
    expect(prepared.text).toContain("\n\nOLEAFLYRAW0\n\n");
    expect(prepared.text).toContain("\n\nOLEAFLYRAW1\n\n");
  });

  it("turns wide floats into normal floats", () => {
    expect(prepared.text).toContain(String.raw`\begin{table}[t]`);
    expect(prepared.text).toContain(String.raw`\end{table}`);
    expect(prepared.text).not.toContain("table*");
  });

  it("remembers labels Typst folds into one equation", () => {
    expect(prepared.equationAliases).toEqual({ "eq:second": "eq:first" });
  });
});

describe("splitConvertedIncludes placeholders", () => {
  it("replaces placeholders with their Typst code", () => {
    const split = splitConvertedIncludes("= A\n\nOLEAFLYRAW0\n\nText", [], ["#outline()"]);
    expect(split.main).toBe("= A\n\n#outline()\n\nText");
  });
});

describe("fixEquationAliases", () => {
  it("points references at the equation that holds the label", () => {
    expect(fixEquationAliases("See @eq:second and @eq:secondary.", { "eq:second": "eq:first" })).toEqual({
      text: "See @eq:first and @eq:secondary.",
      used: ["eq:second"],
    });
  });
});

describe("fixBlockReferences", () => {
  it("links to labelled blocks Typst cannot reference", () => {
    const chapter = ["#block[", "#strong[Definition 2.1] (Fraction). Text.", "", "] <def:fraction>"].join("\n");
    const other = "Definition~@def:fraction and @def:fraction. and @sec:intro";
    expect(fixBlockReferences([chapter, other])).toEqual([
      chapter,
      "Definition~#link(<def:fraction>)[2.1] and #link(<def:fraction>)[2.1]. and @sec:intro",
    ]);
  });
});

describe("relativeTypstPath", () => {
  it("points from one file to another", () => {
    expect(relativeTypstPath("main.typ", "chapters/one.typ")).toBe("chapters/one.typ");
    expect(relativeTypstPath("chapters/one.typ", "chapters/sub.typ")).toBe("sub.typ");
    expect(relativeTypstPath("chapters/one.typ", "appendix/a.typ")).toBe("../appendix/a.typ");
    expect(relativeTypstPath("a/b/c.typ", "d.typ")).toBe("../../d.typ");
  });
});

describe("splitConvertedIncludes", () => {
  const includes = prepareLatexProject("main.tex", TEXTS).includes;
  const typst = [
    "#show: doc => conf(",
    "  doc,",
    ")",
    "",
    "= Intro",
    "",
    "OLEAFLYINCLUDEBEGIN0",
    "",
    "= One",
    "",
    "OLEAFLYINCLUDEBEGIN1",
    "",
    "Sub text.",
    "",
    "OLEAFLYINCLUDEEND1",
    "",
    "OLEAFLYINCLUDEEND0",
    "",
    "Tail.",
  ].join("\n");

  it("moves each include into its own file and links it with #include", () => {
    const split = splitConvertedIncludes(typst, includes);
    expect(split.main).toBe(
      ["#show: doc => conf(", "  doc,", ")", "", "= Intro", "", '#pagebreak(weak: true)\n#include "chapters/one.typ"', "", "Tail."].join(
        "\n",
      ),
    );
    expect(split.parts).toEqual([
      { target: "chapters/sub.typ", text: "Sub text.\n" },
      { target: "chapters/one.typ", text: '= One\n\n#include "sub.typ"\n' },
    ]);
    expect(split.lost).toEqual([]);
  });

  it("keeps the text in place when a marker went missing", () => {
    const broken = typst.replace("OLEAFLYINCLUDEEND1", "");
    const split = splitConvertedIncludes(broken, includes);
    expect(split.main).not.toContain("OLEAFLYINCLUDE");
    expect(split.parts.map((part) => part.text).join("\n") + split.main).toContain("Sub text.");
    expect(split.lost).toContain(1);
  });
});

describe("fixCrossReferences", () => {
  it("turns resolved and unresolved reference links into Typst references", () => {
    expect(
      fixCrossReferences(String.raw`See #link(<sec:intro>)[1], #link(<sec:x>)[2.1] and #link(<eq:a>)[\[eq:a\]].`),
    ).toEqual({ text: "See @sec:intro, @sec:x and @eq:a.", count: 3 });
  });

  it("keeps links that carry their own text", () => {
    const text = '#link(<sec:intro>)[the intro] and #link("https://typst.app")[1]';
    expect(fixCrossReferences(text)).toEqual({ text, count: 0 });
  });
});

describe("fixImagePaths", () => {
  const available = new Set(["figures/plot.png", "figures/diagram.pdf", "logo.eps", "photo.jpg"]);

  it("adds the file extension and the graphics path", () => {
    const result = fixImagePaths(
      'image("plot", width: 50%) image("figures/diagram") image("photo.jpg")',
      "main.typ",
      available,
      ["figures/"],
    );
    expect(result.text).toBe('image("figures/plot.png", width: 50%) image("figures/diagram.pdf") image("photo.jpg")');
    expect(result.missing).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });

  it("makes paths relative to the file that shows the image", () => {
    expect(fixImagePaths('image("figures/plot.png")', "chapters/one.typ", available, []).text).toBe(
      'image("../figures/plot.png")',
    );
  });

  it("reports formats Typst cannot show and images that are not there", () => {
    const result = fixImagePaths('image("logo") image("nothing")', "main.typ", available, []);
    expect(result.text).toBe('image("logo") image("nothing")');
    expect(result.unsupported).toEqual(["logo.eps"]);
    expect(result.missing).toEqual(["nothing"]);
  });
});

describe("fixUnconvertedMath", () => {
  it("converts math Pandoc left as escaped LaTeX", () => {
    const text = String.raw`Before \$\$\\begin{equation}
\\int\_0^1 f(x)\\,dx \\label{eq:1}
\\end{equation}\$\$ after.`;
    const result = fixUnconvertedMath(text, "0.15.1");
    expect(result.fixed).toHaveLength(1);
    expect(result.remaining).toEqual([]);
    expect(result.text).toMatch(/^Before \$ .*integral.* \$<eq:1> after\.$/su);
  });

  it("leaves math it cannot convert and reports it", () => {
    const text = String.raw`Value \$\\weirdmacro{a}\$ here.`;
    const result = fixUnconvertedMath(text, null);
    expect(result.text).toBe(text);
    expect(result.remaining).toEqual([String.raw`\weirdmacro{a}`]);
  });

  it("leaves escaped dollar signs in prose alone", () => {
    const text = String.raw`It costs \$5 and \$6.`;
    expect(fixUnconvertedMath(text, null)).toEqual({ text, fixed: [], remaining: [] });
  });
});

describe("numberLabelledEquations", () => {
  const main = "#show: doc => conf(\n  doc,\n)\n\n= Intro\n";

  it("numbers equations when one carries a label", () => {
    expect(numberLabelledEquations(main, ["$ x = 1 $<eq:a>"])).toBe(
      '#show: doc => conf(\n  doc,\n)\n#set math.equation(numbering: "(1)")\n\n= Intro\n',
    );
  });

  it("leaves documents without labelled equations alone", () => {
    expect(numberLabelledEquations(main, ["$ x = 1 $"])).toBe(main);
    const numbered = '#set math.equation(numbering: "1")\n$ x $ <eq:a>';
    expect(numberLabelledEquations(numbered, [numbered])).toBe(numbered);
  });
});

describe("applyBibliographyStyle", () => {
  it("maps common BibTeX styles to Typst styles", () => {
    expect(applyBibliographyStyle('#bibliography(("refs.bib"))\n', "IEEEtran")).toEqual({
      text: '#bibliography(("refs.bib"), style: "ieee")\n',
      style: "ieee",
    });
    expect(applyBibliographyStyle('#bibliography("refs.bib")', "apalike").style).toBe("apa");
  });

  it("keeps the default for styles it does not know or a style already set", () => {
    expect(applyBibliographyStyle('#bibliography("refs.bib")', "mystyle")).toEqual({
      text: '#bibliography("refs.bib")',
      style: null,
    });
    const styled = '#bibliography("refs.bib", style: "apa")';
    expect(applyBibliographyStyle(styled, "IEEEtran")).toEqual({ text: styled, style: null });
  });
});

describe("carrySharedDefinitions", () => {
  it("copies one line definitions a split file uses", () => {
    const main = [
      "#let horizontalrule = line(start: (25%,0%), end: (75%,0%))",
      "#let unused = 1",
      "#show: doc => conf(",
      "  doc,",
      ")",
    ].join("\n");
    expect(carrySharedDefinitions(main, "Text\n#horizontalrule\n")).toBe(
      "#let horizontalrule = line(start: (25%,0%), end: (75%,0%))\n\nText\n#horizontalrule\n",
    );
    expect(carrySharedDefinitions(main, "Plain text\n")).toBe("Plain text\n");
  });
});

describe("pandocReportNotes", () => {
  const origins = Array.from({ length: 40 }, (_, index) => ({ file: index < 20 ? "main.tex" : "chapters/one.tex", line: index + 1 }));

  it("maps Pandoc's lines back to the original files and drops harmless skips", () => {
    expect(
      pandocReportNotes(
        [
          String.raw`Skipped '\centering' at line 12 column 11`,
          String.raw`Skipped '\begin{tikzpicture} ...' at line 30 column 1`,
          "Could not load include file missing.tex at source.tex line 5 column 1",
          String.raw`Could not convert TeX math \foo, rendering as TeX:`,
          String.raw`Could not convert TeX math \fixedmacro, rendering as TeX:`,
        ],
        origins,
        [String.raw`\fixedmacro`],
      ),
    ).toEqual([
      { kind: "pandoc", detail: String.raw`Skipped '\begin{tikzpicture} ...'`, source: { file: "chapters/one.tex", line: 30 } },
      { kind: "pandoc", detail: String.raw`Could not convert TeX math \foo, rendering as TeX:` },
    ]);
  });
});

function encode(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

describe("runLatexToTypstMigration", () => {
  const tree = [
    { path: "main.tex", is_dir: false },
    { path: "macros.tex", is_dir: false },
    { path: "chapters", is_dir: true },
    { path: "chapters/one.tex", is_dir: false },
    { path: "chapters/sub.tex", is_dir: false },
    { path: "figures/table.tex", is_dir: false },
    { path: "inline.tex", is_dir: false },
    { path: "figures/plot.png", is_dir: false },
    { path: "refs.bib", is_dir: false },
    { path: "main.aux", is_dir: false },
    { path: "main.pdf", is_dir: false },
    { path: ".git/config", is_dir: false },
  ];
  const binaries: Record<string, string> = {
    "figures/plot.png": bytesToBase64(new Uint8Array([137, 80, 78, 71])),
    "refs.bib": encode("@article{knuth, title={Art}}"),
  };

  function deps(overrides: Partial<MigrationDeps> = {}) {
    const created: CreateAdHocProjectRequest[] = [];
    const converted: AdHocConversionRequest[] = [];
    const read: string[] = [];
    const base: MigrationDeps = {
      listFiles: vi.fn(async () => tree),
      readFileBase64: vi.fn(async (_id: string, path: string) => {
        read.push(path);
        return binaries[path] ?? encode(TEXTS.get(path) ?? "");
      }),
      ensurePandoc: vi.fn(async () => true),
      convert: vi.fn(async (request: AdHocConversionRequest) => {
        converted.push(request);
        const body = (request.text ?? "")
          .split("\n")
          .filter((line) => line.startsWith("OLEAFLYINCLUDE") || /^[A-Z]/u.test(line))
          .join("\n\n");
        return {
          kind: "text" as const,
          text: `#show: doc => conf(\n  doc,\n)\n\n${body}\n\n#image("plot")\n\n#bibliography(("refs.bib"))\n`,
          dataBase64: null,
          fileName: "converted.typ",
          mediaType: "text/x-typst",
          files: [],
          report: [String.raw`Skipped '\begin{tikzpicture} ...' at line 6 column 1`],
        };
      }),
      createProject: vi.fn(async (request: CreateAdHocProjectRequest) => {
        created.push(request);
        return "new-project";
      }),
      compile: vi.fn(
        async (): Promise<CompileResult> => ({
          ok: false,
          has_pdf: false,
          output_id: null,
          output_revision: null,
          log: "",
          errors: [{ file: "chapters/one.typ", line: 3, message: "unknown variable: foo", kind: "error", explanation: null }],
          diagnostics: [{ severity: "warning", message: "unused label", file: "main.typ", line: 2, category: "package-warning" }],
          synctex_path: null,
          out_dir: null,
          compile_time_ms: 10,
        }),
      ),
      ...overrides,
    };
    return { deps: base, created, converted, read };
  }

  const request = {
    projectId: "latex-project",
    mainDoc: "main.tex",
    name: "Paper (Typst)",
    typstVersion: "0.15.1",
  };

  it("creates a new Typst project, compiles it and reports what happened", async () => {
    const { deps: fake, created, converted, read } = deps();
    const steps: string[] = [];
    const report = await runLatexToTypstMigration(request, fake, (step) => steps.push(step));

    expect(steps).toEqual(["reading", "converting", "creating", "compiling"]);
    expect(read).not.toContain("main.aux");
    expect(read).not.toContain("main.pdf");
    expect(read).not.toContain(".git/config");
    expect(converted[0]).toMatchObject({ source: "latex", target: "typst", report: true });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Paper (Typst)", target: "typst", mainFile: "main.typ" });
    expect(created[0].text).toBeUndefined();
    const paths = created[0].files.map((file) => file.path).sort();
    expect(paths).toEqual(["chapters/one.typ", "chapters/sub.typ", "figures/plot.png", "main.typ", "refs.bib"]);
    const main = new TextDecoder().decode(
      base64ToBytes(created[0].files.find((file) => file.path === "main.typ")?.dataBase64 ?? ""),
    );
    expect(main).toContain('#include "chapters/one.typ"');
    expect(main).toContain('image("figures/plot.png")');
    expect(main).toContain('style: "ieee"');
    expect(fake.compile).toHaveBeenCalledWith("new-project", "main.typ");

    expect(report.projectId).toBe("new-project");
    expect(report.converted.sources).toEqual([
      { source: "main.tex", target: "main.typ" },
      { source: "chapters/one.tex", target: "chapters/one.typ" },
      { source: "chapters/sub.tex", target: "chapters/sub.typ" },
    ]);
    expect(report.converted.bibliographies).toEqual(["refs.bib"]);
    expect(report.converted.style).toBe("ieee");
    expect(report.attention).toContainEqual({ kind: "missingInclude", detail: "missing", source: { file: "main.tex", line: 12 } });
    expect(report.compile?.ok).toBe(false);
    expect(report.compile?.problems).toEqual([
      { severity: "error", message: "unknown variable: foo", file: "chapters/one.typ", line: 3 },
      { severity: "warning", message: "unused label", file: "main.typ", line: 2 },
    ]);
  });

  it("stops before creating anything when Pandoc is not ready", async () => {
    const { deps: fake } = deps({ ensurePandoc: vi.fn(async () => false) });
    await expect(runLatexToTypstMigration(request, fake)).rejects.toThrow();
    expect(fake.createProject).not.toHaveBeenCalled();
  });

  it("still reports the new project when the compile cannot run", async () => {
    const { deps: fake } = deps({ compile: vi.fn(async () => Promise.reject(new Error("no typst"))) });
    const report = await runLatexToTypstMigration(request, fake);
    expect(report.projectId).toBe("new-project");
    expect(report.compile).toBeNull();
    expect(report.compileFailure).toBe("no typst");
  });

  it("uses unsaved editor text instead of the file on disk", async () => {
    const { deps: fake, converted } = deps();
    await runLatexToTypstMigration({ ...request, buffers: new Map([["inline.tex", "EDITED"]]) }, fake);
    expect(converted[0].text).toContain("Text EDITED more.");
  });
});
