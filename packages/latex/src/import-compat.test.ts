import { describe, expect, it } from "vitest";
import { scanImportCompatibility } from "./import-compat";

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
});
