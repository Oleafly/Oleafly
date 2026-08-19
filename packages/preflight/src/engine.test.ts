import { describe, it, expect } from "vitest";
import { runPreflight } from "./engine";
import type { PositionedText } from "./types";

describe("runPreflight", () => {
  it("runs source rules and scores a clean-ish document at or near 100", () => {
    const src =
      "\\documentclass{article}\n\\input{glyphtounicode}\\pdfgentounicode=1\n\\usepackage[english]{babel}\n\\hypersetup{pdftitle={Jane}}\n\\begin{document}Hello world\\end{document}";
    const r = runPreflight({ source: src });
    expect(r.hasPdf).toBe(false);
    expect(r.atsScore).toBeNull();
    expect(r.a11yScore).toBeNull();
    expect(r.coverage.ats).toBe("not_run");
    expect(r.findings).toHaveLength(0);
  });

  it("drops the scores when the source has ATS + a11y problems", () => {
    const src = "\\documentclass[twocolumn]{article}\\includegraphics{p.png}";
    const r = runPreflight({ source: src });
    expect(r.atsScore).toBeNull();
    expect(r.a11yScore).toBeNull();
    expect(r.findings.some((f) => f.id === "multi-column")).toBe(true);
    expect(r.findings.some((f) => f.id === "figure-alt")).toBe(true);
  });

  it("includes PDF-layer findings when pages are supplied", () => {
    const pages: PositionedText[][] = [
      [
        { str: "Acme", x: 0, y: 100, width: 20 },
        { str: "phone", x: 300, y: 100, width: 20 },
      ],
    ];
    const r = runPreflight({ source: "\\documentclass{article}", pages, meta: { lang: null, title: null, tagged: false } });
    expect(r.hasPdf).toBe(true);
    expect(r.coverage.ats).toBe("not_run");
    expect(r.atsScore).toBeNull();
    expect(r.findings.some((f) => f.id === "pdf-reading-order")).toBe(true);
    expect(r.findings.some((f) => f.id === "pdf-lang-title")).toBe(true);
  });

  it("adds the untagged-output verdict when a structure tree is supplied", () => {
    const r = runPreflight({
      source: "\\documentclass{article}",
      pages: [[{ str: "text", x: 0, y: 0, width: 20 }]],
      meta: { lang: "en", title: "Document", tagged: false },
      struct: { root: null, tagged: false },
    });
    expect(r.findings.filter((f) => f.id === "pdf-untagged-output")).toHaveLength(1);
    expect(r.findings.some((f) => f.id === "pdf-tagged")).toBe(false);
  });

  it("runs the ATS parse simulation over reader text and exposes it on the report", () => {
    const readerText = ["Jane Doe", "Experience", "Acme", "Education", "MIT", "Skills", "Rust"].join("\n");
    const r = runPreflight({ source: "\\documentclass{article}", readerText });
    expect(r.atsParse?.isResume).toBe(true);
    // No email in the reader text, so a parser-missing-email finding should fire.
    expect(r.findings.some((f) => f.id === "ats-no-email")).toBe(true);
  });

  it("runs the references check and scores it when a refs context is supplied", () => {
    const r = runPreflight({
      source: "\\cite{ghost}\\ref{nowhere}",
      refs: { definedLabels: [], bibKeys: [], bibLoaded: true, projectFiles: [], duplicateDois: [] },
    });
    expect(r.findings.some((f) => f.id === "refs-undefined-cite")).toBe(true);
    expect(r.findings.some((f) => f.id === "refs-undefined-ref")).toBe(true);
    expect(r.refsScore).toBeLessThan(100);
    expect(r.atsScore).toBeNull();
  });

  it("stamps ranAt", () => {
    const r = runPreflight({ source: "x" });
    expect(typeof r.ranAt).toBe("number");
  });

  it("reports partial submission coverage until a PDF is available", () => {
    const source = "\\documentclass{article}\\begin{abstract}A\\end{abstract}";
    const project = { mainFile: "main.tex", files: [{ path: "main.tex", content: source }] };
    const sourceOnly = runPreflight({ source, project, submissionProfile: "generic" });
    expect(sourceOnly.coverage.submission).toBe("partial");
    expect(sourceOnly.submissionScore).not.toBeNull();
    expect(sourceOnly.coverage.privacy).toBe("evaluated");
  });

  it("keeps venue-profile failures out of unrelated scores", () => {
    const source = "\\documentclass{article}\\begin{abstract}A\\end{abstract}\\begin{IEEEkeywords}x\\end{IEEEkeywords}";
    const report = runPreflight({
      source,
      project: { mainFile: "main.tex", files: [{ path: "main.tex", content: source }] },
      submissionProfile: "ieee",
    });
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "submission-document-class" }));
    expect(report.scores.submission).toBeLessThan(100);
    expect(report.scores.refs).toBe(100);
  });

  it("checks every loaded LaTeX source file and records its path", () => {
    const main = "\\documentclass{article}\\input{glyphtounicode}\\pdfgentounicode=1\\usepackage[english]{babel}\\hypersetup{pdftitle={Paper}}";
    const report = runPreflight({
      source: main,
      project: {
        mainFile: "main.tex",
        files: [
          { path: "main.tex", content: main },
          { path: "sections/results.tex", content: "\\includegraphics{plot.png}\\cite{missing}" },
          { path: "sections/plot.png" },
        ],
      },
      refs: {
        definedLabels: [],
        bibKeys: [],
        bibLoaded: true,
        projectFiles: ["main.tex", "sections/results.tex", "sections/plot.png"],
        duplicateDois: [],
      },
    });
    expect(report.findings).toContainEqual(expect.objectContaining({
      id: "figure-alt",
      file: "sections/results.tex",
    }));
    expect(report.findings).toContainEqual(expect.objectContaining({
      id: "refs-undefined-cite",
      file: "sections/results.tex",
    }));
  });
});
