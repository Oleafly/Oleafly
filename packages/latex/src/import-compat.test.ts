import { describe, expect, it } from "vitest";
import {
  classifyCompileFailure,
  importCompatFinding,
  latexmkFixesFinding,
  loadsPackage,
  missingLatexPackages,
  scanImportCompatibility,
  stripLineComments,
} from "./import-compat";

describe("scanImportCompatibility", () => {
  it("flags biblatex + biber journal-style projects", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: String.raw`\usepackage[backend=biber,style=authoryear]{biblatex}
\addbibresource{references.bib}`,
        },
      ],
    });
    expect(findings.some((f) => f.id === "biblatex-biber")).toBe(true);
  });

  it("flags biblatex when latexmkrc selects biber", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: String.raw`\documentclass{article}\begin{document}Hi\end{document}`,
        },
      ],
      latexmkrc: "$bibtex = 'biber %O %S';\n",
    });
    expect(findings.some((f) => f.id === "biblatex-biber")).toBe(true);
  });

  it("flags minted and glossaries as blockers", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: String.raw`\usepackage{minted}\usepackage{glossaries}\makeglossaries`,
        },
      ],
    });
    expect(findings.map((f) => f.id).sort()).toEqual(
      expect.arrayContaining(["minted", "glossaries-index"]),
    );
    expect(findings.filter((f) => f.level === "blocker").length).toBeGreaterThanOrEqual(2);
  });

  it("flags pythontex, shell-escape, fontspec, and pdftex-oriented packages", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: [
            String.raw`\usepackage{pythontex}`,
            String.raw`\write18{echo hi}`,
            String.raw`\usepackage{fontspec}`,
            String.raw`\setmainfont{Times}`,
            String.raw`\usepackage{inputenc}`,
          ].join("\n"),
        },
      ],
    });
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["pythontex", "shell-escape", "fontspec", "pdftex-only"]),
    );
  });

  it("ignores commented-out usepackage lines", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: [
            String.raw`% \usepackage{minted}`,
            String.raw`% \usepackage{glossaries}`,
            String.raw`% \usepackage{pythontex}`,
            String.raw`\documentclass{article}`,
            String.raw`\usepackage{amsmath}`,
            String.raw`\begin{document}Hello\end{document}`,
          ].join("\n"),
        },
      ],
    });
    expect(findings.map((f) => f.id)).toEqual([]);
  });

  it("stripLineComments keeps escaped percent", () => {
    expect(stripLineComments(String.raw`100\% done % trailing`)).toBe(
      String.raw`100\% done `,
    );
  });

  it("returns empty for a plain article", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: String.raw`\documentclass{article}\begin{document}Hi\end{document}`,
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it("loadsPackage matches option lists and multi-package braces linearly", () => {
    expect(loadsPackage(String.raw`\usepackage{graphicx}`, "graphicx")).toBe(true);
    expect(
      loadsPackage(String.raw`\usepackage[backend=biber]{biblatex}`, "biblatex"),
    ).toBe(true);
    expect(loadsPackage(String.raw`\usepackage{amsmath,minted}`, "minted")).toBe(true);
    expect(loadsPackage(String.raw`\usepackage{amsmath}`, "minted")).toBe(false);
  });
});

describe("classifyCompileFailure", () => {
  it("recognizes a minted shell-escape refusal", () => {
    const log =
      "Package minted Error: You must invoke LaTeX with the -shell-escape flag.";
    expect(classifyCompileFailure(log).map((f) => f.id)).toContain("minted");
  });

  it("does not double-report shell-escape when minted already matched", () => {
    const log =
      "Package minted Error: You must invoke LaTeX with the -shell-escape flag.";
    const ids = classifyCompileFailure(log).map((f) => f.id);
    expect(ids).not.toContain("shell-escape");
  });

  it("recognizes a missing glossary/index artifact", () => {
    const log = "No file _oleafly_entry.gls.\nOutput written on x.pdf";
    expect(classifyCompileFailure(log).map((f) => f.id)).toContain(
      "glossaries-index",
    );
  });

  it("recognizes the unresolved-Biber marker appended by the compile layer", () => {
    const log = "[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.";
    expect(classifyCompileFailure(log).map((f) => f.id)).toContain(
      "biblatex-biber",
    );
  });

  it("recognizes pdfTeX primitives failing under XeTeX (Springer sn-jnl shape)", () => {
    const log = [
      "! Undefined control sequence.",
      String.raw`\burl@condpdflink ...f@box \dimen@ii \dp \pdf@box`,
    ].join("\n");
    expect(classifyCompileFailure(log).map((f) => f.id)).toContain("pdftex-only");
  });

  it("stays silent on ordinary user errors", () => {
    const log = [
      "! Undefined control sequence.",
      String.raw`l.42 \foo`,
      "! Missing $ inserted.",
    ].join("\n");
    expect(classifyCompileFailure(log)).toEqual([]);
  });
});

describe("taxonomy catalog", () => {
  it("marks latexmk-fixable findings and exposes entries by id", () => {
    expect(latexmkFixesFinding("minted")).toBe(true);
    expect(latexmkFixesFinding("fontspec")).toBe(false);
    expect(latexmkFixesFinding("not-a-real-id")).toBe(false);
    const finding = importCompatFinding("class-compat");
    expect(finding.level).toBe("warning");
    expect(finding.title.length).toBeGreaterThan(0);
  });
});

describe("missingLatexPackages", () => {
  it("extracts package stems from missing .sty and .cls errors", () => {
    const log = [
      "! LaTeX Error: File `siunitx.sty' not found.",
      "! LaTeX Error: File `sn-jnl.cls' not found.",
      "! I can't find file `algorithmic.sty'.",
    ].join("\n");
    expect(missingLatexPackages(log).sort()).toEqual([
      "algorithmic",
      "siunitx",
      "sn-jnl",
    ]);
  });

  it("ignores missing files that are not packages or classes", () => {
    const log = [
      "! LaTeX Error: File `figure1.pdf' not found.",
      "! I can't find file `chapters/intro.tex'.",
    ].join("\n");
    expect(missingLatexPackages(log)).toEqual([]);
  });

  it("deduplicates repeated misses and rejects unsafe names", () => {
    const log = [
      "! LaTeX Error: File `siunitx.sty' not found.",
      "! LaTeX Error: File `siunitx.sty' not found.",
      "! LaTeX Error: File `bad name$.sty' not found.",
    ].join("\n");
    expect(missingLatexPackages(log)).toEqual(["siunitx"]);
  });
});
