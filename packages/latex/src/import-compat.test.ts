import { describe, expect, it } from "vitest";
import {
  classifyCompileFailure,
  importCompatAction,
  importCompatFinding,
  latexmkFixesFinding,
  loadsPackage,
  missingLatexFiles,
  needsPdflatexFinding,
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

  it("recognizes a class that pins hyperref to the pdftex driver", () => {
    const log = [
      "! Package hyperref Error: Wrong driver option `pdftex',",
      "(hyperref)                because XeTeX is running.",
    ].join("\n");
    const finding = classifyCompileFailure(log).find(
      (f) => f.id === "hyperref-pdftex-driver",
    );
    expect(finding).toBeDefined();
    expect(needsPdflatexFinding("hyperref-pdftex-driver")).toBe(true);
    expect(
      classifyCompileFailure("! Package hyperref Error: Wrong driver option `dvips'."),
    ).toEqual([]);
  });

  it("names the EPS image the bundled engine could not place", () => {
    const tectonic = classifyCompileFailure(
      'error: pdf: image inclusion failed for "images/MDHlogga.eps"',
    ).find((f) => f.id === "eps-image");
    expect(tectonic?.detail).toContain("images/MDHlogga.eps");

    const epstopdf = classifyCompileFailure(
      [
        "Package epstopdf Warning: Shell escape feature is not enabled.",
        "! LaTeX Error: File `images/MDUlogo-eps-converted-to.pdf' not found.",
      ].join("\n"),
    ).find((f) => f.id === "eps-image");
    expect(epstopdf?.detail).toContain("images/MDUlogo.eps");

    expect(
      classifyCompileFailure('error: pdf: image inclusion failed for "figure.png"').map(
        (f) => f.id,
      ),
    ).not.toContain("eps-image");
  });

  it("offers the package installer for a file missing from the bundled engine", () => {
    const log = "! LaTeX Error: File `thesisMDU.cls' not found.";
    const finding = classifyCompileFailure(log).find(
      (f) => f.id === "missing-sty-on-bundled-engine",
    );
    expect(finding?.detail).toContain("thesisMDU.cls");
    expect(importCompatAction("missing-sty-on-bundled-engine")).toBe(
      "install-after-switch",
    );
    expect(
      classifyCompileFailure(log, { bundledEngine: false }).map((f) => f.id),
    ).not.toContain("missing-sty-on-bundled-engine");
  });

  it("reports a failed bundle download on its own and never as a missing package", () => {
    const log = [
      "error: this bundle isn't cached, and we couldn't get it from the internet",
      'caused by: unexpected HTTP response code 429 Too Many Requests for URL https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar',
      "! LaTeX Error: File `amsmath.sty' not found.",
    ].join("\n");
    const findings = classifyCompileFailure(log);
    expect(findings.map((f) => f.id)).toEqual(["bundle-fetch-failed"]);
    expect(findings[0].detail).toContain("HTTP 429");
    expect(importCompatAction("bundle-fetch-failed")).toBe("retry-compile");
    expect(latexmkFixesFinding("bundle-fetch-failed")).toBe(false);

    const noStatus = classifyCompileFailure(
      'note: failed to download "msbm10.tfm" from https://mirrors.oleafly.com/tex-bundles/x.tar',
    );
    expect(noStatus.map((f) => f.id)).toEqual(["bundle-fetch-failed"]);
    expect(noStatus[0].detail).not.toContain("HTTP");
  });

  it("keeps unrelated connection text from hiding a missing package", () => {
    const unrelated = classifyCompileFailure(
      [
        "Package biblatex Warning: error connecting to the citation service",
        "! LaTeX Error: File `thesisMDU.cls' not found.",
      ].join("\n"),
    ).map((f) => f.id);
    expect(unrelated).toContain("missing-sty-on-bundled-engine");
    expect(unrelated).not.toContain("bundle-fetch-failed");

    const mirror = classifyCompileFailure(
      [
        "error: connecting to https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar failed",
        "! LaTeX Error: File `thesisMDU.cls' not found.",
      ].join("\n"),
    ).map((f) => f.id);
    expect(mirror).toEqual(["bundle-fetch-failed"]);
  });

  it("reads the HTTP status from the mirror failure, not from unrelated text", () => {
    const finding = classifyCompileFailure(
      [
        "Package foo Info: unexpected HTTP response code 418 from the linter",
        "error: failed to download the bundle",
        "caused by: unexpected HTTP response code 503 for URL https://mirrors.oleafly.com/tex-bundles/x.tar",
      ].join("\n"),
    )[0];
    expect(finding.id).toBe("bundle-fetch-failed");
    expect(finding.detail).toContain("HTTP 503");
    expect(finding.detail).not.toContain("418");
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

  it("gives every entry an action and no em dashes", () => {
    for (const id of [
      "minted",
      "pdftex-only",
      "class-compat",
      "hyperref-pdftex-driver",
      "eps-image",
      "missing-sty-on-bundled-engine",
      "bundle-fetch-failed",
    ] as const) {
      const finding = importCompatFinding(id);
      expect(finding.detail).not.toMatch(/[\u2014\u2013]/);
      expect(importCompatAction(id)).toBeDefined();
    }
    expect(importCompatAction("not-a-real-id")).toBe("switch-to-latexmk");
    expect(needsPdflatexFinding("minted")).toBe(false);
  });
});

describe("missingLatexFiles", () => {
  it("extracts filenames from missing .sty and .cls errors", () => {
    const log = [
      "! LaTeX Error: File `siunitx.sty' not found.",
      "! LaTeX Error: File `sn-jnl.cls' not found.",
      "! I can't find file `algorithmic.sty'.",
    ].join("\n");
    expect(missingLatexFiles(log).sort()).toEqual([
      "algorithmic.sty",
      "siunitx.sty",
      "sn-jnl.cls",
    ]);
  });

  it("ignores missing files that are not packages or classes", () => {
    const log = [
      "! LaTeX Error: File `figure1.pdf' not found.",
      "! I can't find file `chapters/intro.tex'.",
    ].join("\n");
    expect(missingLatexFiles(log)).toEqual([]);
  });

  it("deduplicates repeated misses and rejects unsafe names", () => {
    const log = [
      "! LaTeX Error: File `siunitx.sty' not found.",
      "! LaTeX Error: File `siunitx.sty' not found.",
      "! LaTeX Error: File `bad name$.sty' not found.",
    ].join("\n");
    expect(missingLatexFiles(log)).toEqual(["siunitx.sty"]);
  });
  it("preserves filenames and recognizes quote variants without treating project paths as packages", () => {
    const log = [
      "! LaTeX Error: File 'tikz.sty' not found.",
      '! LaTeX Error: File "university_thesis.cls" not found.',
      "! LaTeX Error: File `styles/custom.sty' not found.",
    ].join("\n");
    expect(missingLatexFiles(log)).toEqual(["tikz.sty", "university_thesis.cls"]);
  });

});
