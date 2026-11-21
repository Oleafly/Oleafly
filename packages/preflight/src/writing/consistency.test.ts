import { describe, expect, it } from "vitest";
import type { Finding, TextEdit } from "../types";
import {
  DEFAULT_WRITING_SETTINGS,
  notationEntries,
  parseWritingSettings,
  runProjectWritingRules,
  writingContextFor,
  type ProjectWritingFile,
  type WritingSettings,
} from "./index";

type Project = Record<string, string>;

const files = (project: Project): ProjectWritingFile[] => Object.entries(project).map(([path, content]) => ({ path, content }));

function run(project: Project, id: string, settings: WritingSettings = DEFAULT_WRITING_SETTINGS): Finding[] {
  const context = { settings, ...writingContextFor(Object.values(project), settings), mainFile: "main.tex" };
  return runProjectWritingRules(files(project), context).filter((finding) => finding.id === id);
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  return [...edits].sort((left, right) => right.from - left.from).reduce((out, edit) => out.slice(0, edit.from) + edit.insert + out.slice(edit.to), text);
}

function applyFix(project: Project, finding: Finding): Project {
  const out = { ...project };
  const file = finding.file ?? "";
  out[file] = applyEdits(out[file], finding.fix?.edits ?? []);
  for (const other of finding.fix?.otherFiles ?? []) out[other.file] = applyEdits(out[other.file], other.edits);
  return out;
}

function expectSeparateEdits(finding: Finding): void {
  for (const edits of [finding.fix?.edits ?? [], ...(finding.fix?.otherFiles ?? []).map((other) => other.edits)]) {
    for (let index = 1; index < edits.length; index += 1) {
      expect(edits[index].from).toBeGreaterThan(edits[index - 1].from);
      expect(edits[index].from).toBeGreaterThanOrEqual(edits[index - 1].to);
    }
  }
}

function named(findings: readonly Finding[], spelling: string): Finding {
  const finding = findings.find((candidate) => String(candidate.detail.params?.spellings).startsWith(spelling));
  if (!finding) throw new Error(`no finding for ${spelling}`);
  return finding;
}

const NAMES: Project = {
  "main.tex": [
    "\\documentclass{article}",
    "\\usepackage{amsmath}",
    "\\begin{document}",
    "\\section{Introduction}",
    "PS-FCN recovers surface normals. We train PS-FCN on synthetic data.",
    "Unlike PSFCN, the US baselines in Table II fail.",
    "\\input{sections/method}",
    "\\end{document}",
    "",
  ].join("\n"),
  "sections/method.tex": [
    "\\section{Method}",
    "% PS-Fcn is an old name.",
    "Our PS-Fcn variant extends ResNet-50 \\cite{PSFCN2018}.",
    "A ResNet50 backbone and PSFCN-based features help. Then PS-FCN predicts normals.",
    "Self-attention is not used. We skip self-attention.",
    "",
  ].join("\n"),
};

describe("writing-name-variants", () => {
  it("groups the spellings of one name across files and anchors at the first odd one", () => {
    const findings = run(NAMES, "writing-name-variants");
    expect(findings.map((finding) => finding.detail.params?.spellings).sort()).toEqual(["PS-FCN 3, PSFCN 2, PS-Fcn 1", "ResNet-50 1, ResNet50 1"]);
    const names = named(findings, "PS-FCN");
    const resnet = named(findings, "ResNet-50");
    expect(names.file).toBe("main.tex");
    expect(NAMES["main.tex"].slice(names.from, names.to)).toBe("PSFCN");
    expect(NAMES["main.tex"].slice(0, names.from)).toMatch(/\nUnlike $/);
    expect(resnet.file).toBe("sections/method.tex");
    expect(NAMES["sections/method.tex"].slice(resnet.from, resnet.to)).toBe("ResNet50");
    expect(names.fix?.label).toEqual({ key: "fixes.makeMacro" });
  });

  it("defines a macro before \\begin{document} and uses it everywhere", () => {
    const names = named(run(NAMES, "writing-name-variants"), "PS-FCN");
    expectSeparateEdits(names);
    const fixed = applyFix(NAMES, names);
    expect(fixed["main.tex"]).toBe(
      [
        "\\documentclass{article}",
        "\\usepackage{amsmath}",
        "\\newcommand{\\PSFCN}{PS-FCN}",
        "\\begin{document}",
        "\\section{Introduction}",
        "\\PSFCN{} recovers surface normals. We train \\PSFCN{} on synthetic data.",
        "Unlike \\PSFCN, the US baselines in Table II fail.",
        "\\input{sections/method}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    expect(fixed["sections/method.tex"]).toBe(
      [
        "\\section{Method}",
        "% PS-Fcn is an old name.",
        "Our \\PSFCN{} variant extends ResNet-50 \\cite{PSFCN2018}.",
        "A ResNet50 backbone and \\PSFCN-based features help. Then \\PSFCN{} predicts normals.",
        "Self-attention is not used. We skip self-attention.",
        "",
      ].join("\n"),
    );
    expect(run(fixed, "writing-name-variants").map((finding) => finding.detail.params?.spellings)).toEqual(["ResNet-50 1, ResNet50 1"]);
  });

  it("uses a macro the project already defines for one of the spellings", () => {
    const project = { ...NAMES, "main.tex": NAMES["main.tex"].replace("\\begin{document}", "\\newcommand{\\NetName}{PS-FCN}\n\\begin{document}") };
    const names = named(run(project, "writing-name-variants"), "PS-FCN");
    expect(names.fix?.label).toEqual({ key: "fixes.useMacro", params: { macro: "\\NetName" } });
    const fixed = applyFix(project, names);
    expect(fixed["main.tex"]).not.toContain("\\newcommand{\\PSFCN}");
    expect(fixed["main.tex"]).toContain("\\NetName{} recovers surface normals. We train \\NetName{} on");
    expect(fixed["main.tex"]).toContain("Unlike \\NetName, the US");
    expect(fixed["sections/method.tex"]).toContain("Our \\NetName{} variant");
    expect(fixed["sections/method.tex"]).toContain("and \\NetName-based features");
  });

  it("picks a free macro name when the obvious one is taken", () => {
    const project = { ...NAMES, "main.tex": NAMES["main.tex"].replace("\\begin{document}", "\\newcommand{\\PSFCN}[1]{#1}\n\\begin{document}") };
    const names = named(run(project, "writing-name-variants"), "PS-FCN");
    const fixed = applyFix(project, names);
    expect(fixed["main.tex"]).toContain("\\newcommand{\\PSFCN}[1]{#1}\n\\newcommand{\\PSFCNName}{PS-FCN}\n\\begin{document}");
    expect(fixed["sections/method.tex"]).toContain("Our \\PSFCNName{} variant");
  });

  it("keeps the definition and a replacement at the same offset in one edit", () => {
    const project = { "main.tex": "PSFCN rocks. PS-FCN and PS-FCN.\n" };
    const [names] = run(project, "writing-name-variants");
    expectSeparateEdits(names);
    expect(new Set(names.fix?.edits.map((edit) => edit.from)).size).toBe(names.fix?.edits.length);
    expect(applyFix(project, names)["main.tex"]).toBe("\\newcommand{\\PSFCN}{PS-FCN}\n\\PSFCN{} rocks. \\PSFCN{} and \\PSFCN.\n");
  });

  it("leaves case changes, command names, keys and math alone", () => {
    const project = {
      "main.tex": [
        "\\documentclass{article}",
        "\\newcommand{\\GANs}{GANs}",
        "\\begin{document}",
        "Self-Supervised learning helps. We use self-supervised learning with \\GANs{} and GANs.",
        "See \\ref{sec:PS-FCN} and $PSFCN_2$ for PS-FCN, II and IV, US and UK.",
        "\\end{document}",
      ].join("\n"),
    };
    expect(run(project, "writing-name-variants")).toEqual([]);
  });

  it("can be switched off", () => {
    expect(run(NAMES, "writing-name-variants", parseWritingSettings({ disabled: ["writing-name-variants"] }))).toEqual([]);
  });
});

const SYMBOLS: Project = {
  "main.tex": [
    "\\documentclass{article}",
    "% where $x$ is the commented input",
    "\\begin{document}",
    "Let $\\mathbf{n}$ be the surface normal at each pixel.",
    "The loss is $L = \\sum_i n_i$, where $\\lambda$ is a weight and $N$ denotes the number of images.",
    "We write $x$, the input, for short.",
    "\\input{sections/method}",
    "\\end{document}",
    "",
  ].join("\n"),
  "sections/method.tex": [
    "\\section{Method}",
    "Here $\\mathbf{n}$ denotes surface normals.",
    "\\begin{equation} y = x \\text{ where $N$ is the count} \\end{equation}",
    "% where $N$ is the batch size.",
    "where $N$ is the number of light directions.",
    "\\(\\lambda\\) represents a weight.",
    "",
  ].join("\n"),
};

describe("writing-symbol-redefined", () => {
  it("flags a symbol given a second meaning and names the first", () => {
    const findings = run(SYMBOLS, "writing-symbol-redefined");
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.file).toBe("sections/method.tex");
    expect(SYMBOLS["sections/method.tex"].slice(finding.from, finding.to)).toBe("$N$ is the number of light directions");
    expect(finding.detail).toEqual({
      key: "rules.writing-symbol-redefined.detail",
      params: { symbol: "$N$", first: "the number of images", second: "the number of light directions", file: "main.tex" },
    });
    expect(finding.fix).toBeUndefined();
  });

  it("reads files in document order from the main file", () => {
    const reversed = Object.fromEntries(Object.entries(SYMBOLS).reverse());
    const [finding] = run(reversed, "writing-symbol-redefined");
    expect(finding.file).toBe("sections/method.tex");
  });
});

describe("notationEntries", () => {
  it("lists the first meaning of every symbol in document order", () => {
    expect(notationEntries(files(SYMBOLS).reverse(), "main.tex")).toEqual([
      { symbol: "\\mathbf{n}", meaning: "the surface normal at each pixel" },
      { symbol: "\\lambda", meaning: "a weight" },
      { symbol: "N", meaning: "the number of images" },
    ]);
  });

  it("follows \\input order and reads the symbol before a relation", () => {
    const project = {
      "sections/a.tex": "Let $x \\in \\mathbb{R}^{n}$ be the input vector.\n",
      "sections/b.tex": "where $f: X \\to Y$ is the \\emph{feature map}, and $x$ denotes the output.\n",
      "main.tex": "\\documentclass{article}\n\\begin{document}\n\\input{sections/b}\n\\include{sections/a}\n\\end{document}\n",
    };
    expect(notationEntries(files(project), "main.tex")).toEqual([
      { symbol: "f:X\\to Y", meaning: "the feature map" },
      { symbol: "x", meaning: "the output" },
    ]);
  });

  it("returns nothing when no symbol is defined", () => {
    expect(notationEntries(files({ "main.tex": "\\begin{document}\nWe write $x$, the input.\n\\end{document}" }), "main.tex")).toEqual([]);
  });
});
describe("writing consistency inputs", () => {
  it("reads only LaTeX documents, never the reviews file", () => {
    const project = {
      "main.tex": "\\documentclass{article}\n\\begin{document}\nWe train PS-FCN here.\n\\end{document}\n",
      "reviews.md": "1. Why is PSFCN slower than PS-Fcn?\n",
    };
    expect(run(project, "writing-name-variants")).toEqual([]);
  });
});

