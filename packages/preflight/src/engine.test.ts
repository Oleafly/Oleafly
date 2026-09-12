import { describe, it, expect } from "vitest";
import { pdfUaAvailability, runPreflight } from "./engine";
import { pdfUaCoverage } from "./standards";
import { verifyStructure } from "./structure";
import type { PdfExtractionStatus, PositionedText } from "./types";

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

  it("flags only the file whose bibliography declaration does not resolve, when two files share a name", () => {
    const report = runPreflight({
      source: "\\documentclass{article}",
      project: {
        mainFile: "main.tex",
        files: [
          { path: "main.tex", content: "\\documentclass{article}" },
          { path: "one/one.tex", content: "\\bibliography{refs}" },
          { path: "one/refs.bib", content: "" },
          { path: "two/two.tex", content: "\\bibliography{refs}" },
        ],
      },
      refs: {
        definedLabels: [],
        bibKeys: [],
        bibLoaded: false,
        projectFiles: ["main.tex", "one/one.tex", "one/refs.bib", "two/two.tex"],
        unresolvedBibliographies: [{ file: "two/two.tex", name: "refs" }],
        duplicateDois: [],
      },
    });
    const missing = report.findings.filter((f) => f.id === "refs-bib-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ file: "two/two.tex" });
  });
});

describe("pdfUaAvailability", () => {
  const ua = {
    displayDocTitle: true,
    suspects: false,
    xmpTitle: "Title",
    infoTitle: "Title",
    uaPart: null,
    uaRev: null,
    taggedTextRuns: 10,
    untaggedTextRuns: 0,
    links: [],
  };
  const root = { role: "Document", alt: null, lang: "en", children: [] };
  const read: PdfExtractionStatus = {
    metadata: "ok",
    markInfo: "ok",
    structure: "ok",
    structureFailedPages: [],
  };

  it("counts nothing as read when the PDF was never inspected", () => {
    expect(pdfUaAvailability(undefined, undefined, undefined)).toMatchObject({
      structure: false,
      markedContent: false,
      viewerPreferences: false,
      annotations: false,
      identifiesAsPdfUa1: false,
      tagged: null,
    });
  });

  it("stops trusting the marked-content and structure evidence when extraction failed", () => {
    const facts = pdfUaAvailability(
      { metadata: "ok", markInfo: "ok", structure: "failed", structureFailedPages: [2] },
      { root, tagged: true, ua },
      undefined,
    );
    expect(facts.structure).toBe(false);
    expect(facts.markedContent).toBe(false);
  });

  it("does not treat catalog rules as evaluated on an untagged PDF", () => {
    const facts = pdfUaAvailability(read, { root: null, tagged: false, ua: { ...ua, uaPart: 1 } }, undefined);
    expect(facts.viewerPreferences).toBe(false);
    expect(facts.annotations).toBe(false);
    expect(facts.markInfo).toBe(false);
    expect(facts.identifiesAsPdfUa1).toBe(true);
  });

  it("treats everything it read on a tagged file with a tag tree as evaluated", () => {
    const facts = pdfUaAvailability(read, { root, tagged: true, ua: { ...ua, uaPart: 1 } }, undefined);
    expect(facts).toEqual({
      metadata: true,
      markInfo: true,
      structure: true,
      viewerPreferences: true,
      annotations: true,
      markedContent: true,
      identifiesAsPdfUa1: true,
      tagged: true,
    });
  });

  it("keeps an unreadable viewer preference out of the evaluated set", () => {
    const facts = pdfUaAvailability(read, { root, tagged: true, ua: { ...ua, displayDocTitle: null } }, undefined);
    expect(facts.viewerPreferences).toBe(false);
    expect(facts.annotations).toBe(true);
  });
});

describe("PDF/UA-1 identification coverage", () => {
  const read: PdfExtractionStatus = {
    metadata: "ok",
    markInfo: "ok",
    structure: "ok",
    structureFailedPages: [],
  };
  const cleanUa = (uaPart: number | null) => ({
    displayDocTitle: true,
    suspects: false,
    xmpTitle: "A tagged paper",
    infoTitle: "A tagged paper",
    uaPart,
    uaRev: null,
    taggedTextRuns: 100,
    untaggedTextRuns: 0,
    links: [],
  });
  const taggedRoot = {
    role: "Document",
    alt: null,
    lang: "en",
    children: [
      { role: "H1", alt: null, lang: null, children: [] },
      { role: "P", alt: null, lang: null, children: [] },
      { role: "P", alt: null, lang: null, children: [] },
    ],
  };
  const coverageFor = (uaPart: number | null, extraction: PdfExtractionStatus = read) => {
    const struct = { root: taggedRoot, tagged: true, ua: cleanUa(uaPart) };
    return pdfUaCoverage(
      verifyStructure(struct, extraction.structureFailedPages),
      pdfUaAvailability(extraction, struct, undefined),
    );
  };

  it("leaves the identification rules unchecked on a clean file that claims nothing", () => {
    const coverage = coverageFor(null);
    expect(coverage.outcomes["5-1"]).toBe("unavailable");
    expect(coverage.outcomes["5-2"]).toBe("unavailable");
    expect(coverage.failed).toEqual([]);
  });

  it("leaves the PDF/UA-1 identification rules unchecked when the file declares part 2", () => {
    const coverage = coverageFor(2);
    expect(coverage.outcomes["5-1"]).toBe("unavailable");
    expect(coverage.outcomes["5-2"]).toBe("unavailable");
  });

  it("verifies the identification rules on a clean file that declares part 1", () => {
    const coverage = coverageFor(1);
    expect(coverage.outcomes["5-1"]).toBe("passed");
    expect(coverage.outcomes["5-2"]).toBe("passed");
  });

  it("leaves the identification rules unchecked when the metadata could not be read", () => {
    const coverage = coverageFor(null, { ...read, metadata: "failed" });
    expect(coverage.outcomes["5-1"]).toBe("unavailable");
    expect(coverage.outcomes["5-2"]).toBe("unavailable");
  });

  it("fails the identification rules when a part 1 claim is not backed by the file", () => {
    const struct = {
      root: taggedRoot,
      tagged: true,
      ua: { ...cleanUa(1), displayDocTitle: false },
    };
    const findings = verifyStructure(struct);
    expect(findings.some((finding) => finding.id === "pdf-ua-claim-mismatch")).toBe(true);
    const coverage = pdfUaCoverage(findings, pdfUaAvailability(read, struct, undefined));
    expect(coverage.outcomes["5-1"]).toBe("failed");
    expect(coverage.outcomes["5-2"]).toBe("failed");
  });

  it("still reports a mismatched part 2 claim without counting the UA-1 rules", () => {
    const struct = {
      root: taggedRoot,
      tagged: true,
      ua: { ...cleanUa(2), displayDocTitle: false },
    };
    const findings = verifyStructure(struct);
    expect(findings.some((finding) => finding.id === "pdf-ua-claim-mismatch")).toBe(true);
    const coverage = pdfUaCoverage(findings, pdfUaAvailability(read, struct, undefined));
    expect(coverage.outcomes["5-1"]).toBe("unavailable");
    expect(coverage.outcomes["5-2"]).toBe("unavailable");
  });

  it("does not count the XMP title rule as verified when only the Info title exists", () => {
    for (const tagged of [true, false]) {
      const struct = {
        root: tagged ? taggedRoot : null,
        tagged,
        ua: { ...cleanUa(null), xmpTitle: null },
      };
      const coverage = pdfUaCoverage(
        verifyStructure(struct),
        pdfUaAvailability(read, struct, undefined),
      );
      expect(coverage.outcomes["7.1-9"], String(tagged)).toBe("failed");
    }
  });
});
