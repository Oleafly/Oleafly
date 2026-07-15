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
    const r = runPreflight({ source: "\\documentclass{article}", struct: { root: null, tagged: false } });
    expect(r.findings.some((f) => f.id === "pdf-untagged-output")).toBe(true);
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
});
