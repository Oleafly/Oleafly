import { describe, expect, it } from "vitest";
import {
  loadsPackage,
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
