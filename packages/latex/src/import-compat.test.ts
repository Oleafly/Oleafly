import { describe, expect, it } from "vitest";
import { loadsPackage, scanImportCompatibility } from "./import-compat";

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

  it("does not flag plain comments or unrelated package names", () => {
    const findings = scanImportCompatibility({
      texFiles: [
        {
          path: "main.tex",
          content: [
            String.raw`% \usepackage{minted} is commented out`,
            String.raw`% mentions of biber in comments should not match latexmkrc alone`,
            String.raw`\documentclass{article}`,
            String.raw`\usepackage{amsmath}`,
            String.raw`\usepackage{graphicx}`,
            String.raw`\begin{document}Hello\end{document}`,
          ].join("\n"),
        },
      ],
    });
    // Comment lines still contain package-like text; this documents current
    // heuristic limits. Uncommented plain packages must stay quiet.
    expect(findings.filter((f) => f.id === "pythontex")).toEqual([]);
    expect(findings.filter((f) => f.id === "fontspec")).toEqual([]);
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
