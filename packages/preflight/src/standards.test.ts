import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_FINDING_IDS,
  NOTHING_INSPECTED,
  PDF_UA_1_COVERED_RULES,
  PDF_UA_1_MACHINE_RULE_TOTAL,
  annotate,
  pdfUaCoverage,
  pdfUaCoverageLine,
  standardRefLabel,
  standardsFor,
  type PdfUaAvailability,
} from "./standards";
import { runSourceRules } from "./source-rules";
import { runPdfRules } from "./pdf-rules";
import { verifyStructure } from "./structure";
import type { Finding, PositionedText } from "./types";

const EVERYTHING_INSPECTED: PdfUaAvailability = {
  metadata: true,
  markInfo: true,
  structure: true,
  viewerPreferences: true,
  annotations: true,
  markedContent: true,
  identifiesAsPdfUa1: true,
  tagged: true,
};

const a11yFindings = (findings: Finding[]) =>
  findings.filter((finding) => finding.lens === "a11y" || finding.lens === "both");

function everyA11ySourceFinding(): Finding[] {
  const sources = [
    "\\documentclass[twocolumn]{article}\\includegraphics{p.png}\\href{https://x.com}{click here}",
    "\\documentclass{article}\\faEnvelope\\ jane@doe.com\\begin{tikzpicture}\\end{tikzpicture}",
    "\\documentclass{article}\\section{A}\\subsubsection{B}\\textcolor{red}{x}\\marginpar{n}",
    "\\documentclass{article}\\DocumentMetadata{pdfstandard=ua-2}\\begin{tabular}{ll}a&b\\\\\\hline c&d\\end{tabular}",
  ];
  return sources.flatMap((source) => runSourceRules(source));
}

function everyA11yOutputFinding(): Finding[] {
  const pages: PositionedText[][] = [
    [
      { str: "Left", x: 0, y: 100, width: 20, height: 4 },
      { str: "Right", x: 300, y: 100, width: 20, height: 4 },
      ...Array.from({ length: 30 }, (_, index) => ({
        str: `tiny ${index}`,
        x: 0,
        y: 80 - index,
        width: 10,
        height: 4,
      })),
    ],
  ];
  const pdf = runPdfRules(pages, { lang: null, title: null, tagged: true }, undefined, {
    version: "1.7",
    pageCount: 12,
    pages: Array.from({ length: 12 }, () => ({ width: 612, height: 792, rotation: 0 })),
    outlineCount: 0,
    linkCount: 1,
    attachmentCount: 0,
    formFieldCount: 0,
    restricted: false,
    author: null,
    creator: null,
    producer: null,
    fonts: [],
  });
  const structure = verifyStructure({
    root: {
      role: "Document",
      alt: null,
      lang: null,
      children: [
        { role: "H1", alt: null, lang: null, children: [] },
        { role: "H3", alt: null, lang: null, children: [] },
        { role: "Figure", alt: null, lang: null, children: [] },
        { role: "Formula", alt: null, lang: null, children: [] },
        { role: "Table", alt: null, lang: null, children: [{ role: "TD", alt: null, lang: null, children: [] }] },
      ],
    },
    tagged: true,
    ua: {
      displayDocTitle: false,
      suspects: true,
      xmpTitle: null,
      infoTitle: "Info only",
      uaPart: 1,
      uaRev: null,
      taggedTextRuns: 10,
      untaggedTextRuns: 10,
      links: [{ hasContents: false }],
    },
  });
  const untagged = verifyStructure({ root: null, tagged: false });
  const missing = verifyStructure({ root: null, tagged: true });
  return [...pdf, ...structure, ...untagged, ...missing, ...everyExtractionDiagnostic()];
}

function everyExtractionDiagnostic(): Finding[] {
  const blind = runPdfRules(
    [[{ str: "Some text", x: 0, y: 0, width: 40 }]],
    { lang: null, title: null, tagged: null },
    { metadata: "failed", markInfo: "failed" },
  );
  return [...blind, ...verifyStructure({ root: null, tagged: null }, [2])];
}

describe("standards table", () => {
  it("cites at least one standard with a url for every accessibility finding", () => {
    const findings = a11yFindings([...everyA11ySourceFinding(), ...everyA11yOutputFinding()]);
    expect(findings.length).toBeGreaterThan(15);
    const uncited = [...new Set(findings.map((finding) => finding.id))].filter(
      (id) => standardsFor(id).length === 0,
    );
    expect(uncited).toEqual([]);
    for (const finding of findings) {
      expect(finding.standards, finding.id).toBeDefined();
      for (const ref of finding.standards ?? []) {
        expect(ref.url, `${finding.id} ${ref.clause}`).toMatch(/^https:\/\//);
        expect(ref.clause).toBeTruthy();
      }
      expect(typeof finding.machineCheckable, finding.id).toBe("boolean");
      expect(finding.method, finding.id).toBeTruthy();
    }
  });

  it("cites the checks an extraction failure left unproven, and keeps the unknown wording", () => {
    const diagnostics = everyExtractionDiagnostic();
    expect(diagnostics.map((finding) => finding.id).sort()).toEqual([...DIAGNOSTIC_FINDING_IDS].sort());
    for (const finding of diagnostics) {
      expect(standardsFor(finding.id).length, finding.id).toBeGreaterThan(0);
      expect(finding.standards, finding.id).toBeDefined();
      expect(finding.severity, finding.id).toBe("info");
      expect(finding.detail, finding.id).toMatch(/unknown result|will not treat the unavailable structure/);
    }
  });

  it("marks judgement calls as not machine-checkable", () => {
    for (const id of [
      "output-small-text",
      "color-only",
      "multi-column-reading-order-risk",
      "reading-order-risk",
      "pdf-reading-order",
      "link-text",
    ]) {
      expect(annotate({ id, lens: "a11y", severity: "info", title: "t", detail: "d" }, "source-heuristic").machineCheckable, id).toBe(false);
    }
    for (const id of ["figure-alt", "pdf-display-doc-title", "pdf-untagged-content", "pdf-link-alt"]) {
      expect(annotate({ id, lens: "a11y", severity: "info", title: "t", detail: "d" }, "pdf-object-model").machineCheckable, id).toBe(true);
    }
  });

  it("keeps bookmarks a WCAG best practice and never cites PDF/UA for it", () => {
    const refs = standardsFor("pdf-no-bookmarks");
    expect(refs.map((ref) => ref.standard)).toEqual(["WCAG-2.2"]);
    expect(refs[0].technique).toBe("PDF2");
  });

  it("renders citation labels in the product format", () => {
    expect(standardsFor("figure-alt").map(standardRefLabel)).toEqual([
      "PDF/UA-1 7.3",
      "PDF/UA-2 8.2.5.28.2",
      "Matterhorn 13-004",
      "WCAG 2.2 SC 1.1.1",
    ]);
  });

  it("does not attach standards to findings outside the accessibility lens", () => {
    const ats = annotate({ id: "layout-table", lens: "ats", severity: "warning", title: "t", detail: "d" }, "source-heuristic");
    expect(ats.standards).toBeUndefined();
    expect(ats.method).toBe("source-heuristic");
  });

  it("keeps an explicit standards list the caller already attached", () => {
    const refs = standardsFor("no-title");
    const kept = annotate(
      { id: "pdf-lang-title", lens: "a11y", severity: "warning", title: "t", detail: "d", standards: refs },
      "pdf-object-model",
    );
    expect(kept.standards).toBe(refs);
  });
});

describe("pdfUaCoverage", () => {
  it("verifies nothing when nothing was inspected", () => {
    const coverage = pdfUaCoverage([], NOTHING_INSPECTED);
    expect(coverage.total).toBe(PDF_UA_1_MACHINE_RULE_TOTAL);
    expect(coverage.covered).toBe(PDF_UA_1_COVERED_RULES.length);
    expect(coverage.passed).toBe(0);
    expect(coverage.failed).toEqual([]);
    expect(coverage.unavailable).toHaveLength(PDF_UA_1_COVERED_RULES.length);
  });

  it("counts every rule it could read and found clean as passed", () => {
    const coverage = pdfUaCoverage([], EVERYTHING_INSPECTED);
    expect(coverage.passed).toBe(PDF_UA_1_COVERED_RULES.length);
    expect(coverage.unavailable).toEqual([]);
    expect(coverage.failed).toEqual([]);
  });

  it("splits passed, failed, and unavailable so every rule is accounted for once", () => {
    const coverage = pdfUaCoverage(verifyStructure({ root: null, tagged: false }), {
      ...EVERYTHING_INSPECTED,
      tagged: false,
    });
    expect(coverage.failed).toContain("7.1-11");
    expect(coverage.failed).toContain("6.2-1");
    expect(coverage.unavailable).toContain("7.3-1");
    expect(coverage.passed + coverage.failed.length + coverage.unavailable.length).toBe(
      PDF_UA_1_COVERED_RULES.length,
    );
    expect(coverage.outcomes["7.1-11"]).toBe("failed");
    expect(coverage.outcomes["7.3-1"]).toBe("unavailable");
  });

  it("never counts a rule as verified when its structure extraction failed", () => {
    const findings = verifyStructure({ root: null, tagged: null }, [2]);
    const coverage = pdfUaCoverage(findings, {
      ...EVERYTHING_INSPECTED,
      structure: false,
      tagged: null,
    });
    for (const rule of ["7.3-1", "7.4.2-1", "7.5-1", "7.5-2", "7.1-11", "6.2-1"]) {
      expect(coverage.outcomes[rule], rule).toBe("unavailable");
    }
    expect(coverage.failed).toEqual([]);
    expect(coverage.passed).toBeLessThan(PDF_UA_1_COVERED_RULES.length);
  });

  it("leaves the identification rules unchecked when the file claims nothing", () => {
    const coverage = pdfUaCoverage([], { ...EVERYTHING_INSPECTED, identifiesAsPdfUa1: false });
    expect(coverage.outcomes["5-1"]).toBe("unavailable");
    expect(coverage.outcomes["5-2"]).toBe("unavailable");
    expect(coverage.passed).toBe(PDF_UA_1_COVERED_RULES.length - 2);
  });

  it("treats a viewer preference it could not read as unknown, not verified", () => {
    const coverage = pdfUaCoverage([], { ...EVERYTHING_INSPECTED, viewerPreferences: false });
    expect(coverage.outcomes["7.1-10"]).toBe("unavailable");
    expect(coverage.passed).toBe(PDF_UA_1_COVERED_RULES.length - 1);
  });

  it("does not let an extraction diagnostic count as a failed rule", () => {
    const coverage = pdfUaCoverage(everyExtractionDiagnostic(), EVERYTHING_INSPECTED);
    expect(coverage.failed).toEqual([]);
  });

  it("ignores source heuristics, which say nothing about the compiled file", () => {
    const source = runSourceRules("\\documentclass{article}\\includegraphics{p.png}");
    expect(pdfUaCoverage(source, EVERYTHING_INSPECTED).failed).toEqual([]);
  });

  it("states the unchecked rules in the summary line only when there are some", () => {
    expect(pdfUaCoverageLine(pdfUaCoverage([], EVERYTHING_INSPECTED))).toBe(
      "PDF/UA-1: 14 of 106 machine-checkable rules verified. Subset check, not a conformance statement.",
    );
    expect(pdfUaCoverageLine(pdfUaCoverage([], NOTHING_INSPECTED))).toBe(
      "PDF/UA-1: 0 of 106 machine-checkable rules verified. Oleafly reads 14 of those rules, and 14 of them could not be checked in this file. Subset check, not a conformance statement.",
    );
  });
});
