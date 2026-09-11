import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "./engine";
import type { PdfUaFacts, StructDoc } from "./structure";
import type { PdfExtractionStatus, PositionedText } from "./types";

const text = (
  str: string,
  x = 72,
  y = 700,
  width = 80,
): PositionedText => ({ str, x, y, width });

const taggedDocument: StructDoc = {
  root: {
    role: "Document",
    alt: null,
    lang: "en-US",
    children: [
      { role: "H1", alt: null, lang: null, children: [] },
      { role: "P", alt: null, lang: null, children: [] },
    ],
  },
  tagged: true,
};

const base: PreflightInput = {
  source: "",
  sourceProfile: "none",
  pages: [[text("Selectable document text")]],
  meta: { lang: "en-US", title: "Accessible document", tagged: true },
  struct: taggedDocument,
};

const ids = (input: PreflightInput) =>
  runPreflight(input).findings.map((finding) => finding.id);

const cleanUa: PdfUaFacts = {
  displayDocTitle: true,
  suspects: false,
  xmpTitle: "Accessible document",
  infoTitle: "Accessible document",
  uaPart: null,
  uaRev: null,
  taggedTextRuns: 40,
  untaggedTextRuns: 0,
  artifactTextRuns: 2,
  links: [{ hasContents: true }],
};

const everythingRead: PdfExtractionStatus = {
  metadata: "ok",
  markInfo: "ok",
  structure: "ok",
  structureFailedPages: [],
};

describe("deterministic PDF accessibility verdicts", () => {
  it("passes a selectable, single-column, tagged PDF with metadata", () => {
    expect(ids(base)).toEqual([]);
  });

  it("reports an otherwise-good blank PDF page with one exact finding", () => {
    expect(ids({ ...base, pages: [[]] })).toEqual(["pdf-selectable"]);
  });

  it("reports a two-column reading-order defect with one exact finding", () => {
    expect(
      ids({
        ...base,
        pages: [
          [
            text("Left one", 0, 100, 30),
            text("Right one", 300, 100, 35),
            text("Left two", 0, 80, 30),
            text("Right two", 300, 80, 35),
          ],
        ],
      }),
    ).toEqual(["pdf-reading-order"]);
  });

  it("reports garbled selectable text with one exact finding", () => {
    expect(ids({ ...base, pages: [[text("Engi�eer")]] })).toEqual(["pdf-garbled"]);
  });

  it("reports missing title and language with the exact metadata finding", () => {
    expect(ids({ ...base, meta: { lang: null, title: null, tagged: true } })).toEqual([
      "pdf-lang-title",
    ]);
  });

  it("deduplicates the untagged defect across catalog and structure checks", () => {
    const report = runPreflight({
      ...base,
      meta: { lang: "en-US", title: "Resume", tagged: false },
      struct: { root: null, tagged: false },
    });
    expect(report.findings.map((finding) => finding.id)).toEqual([
      "pdf-untagged-output",
    ]);
    expect(report.a11yScore).toBe(98);
  });

  it("reports metadata extraction failure as unknown, not missing metadata", () => {
    expect(
      ids({
        ...base,
        meta: { lang: null, title: null, tagged: true },
        extraction: {
          metadata: "failed",
          markInfo: "ok",
          structure: "ok",
          structureFailedPages: [],
        },
      }),
    ).toEqual(["pdf-metadata-extraction-failed"]);
  });

  it("reports partial structure extraction without claiming an untagged PDF", () => {
    expect(
      ids({
        ...base,
        meta: { lang: "en-US", title: "Resume", tagged: null },
        struct: { root: null, tagged: null },
        extraction: {
          metadata: "ok",
          markInfo: "failed",
          structure: "failed",
          structureFailedPages: [2],
        },
      }),
    ).toEqual([
      "pdf-mark-info-extraction-failed",
      "pdf-structure-extraction-failed",
    ]);
  });

  it("reports no PDF/UA coverage at all when there is no compiled output", () => {
    expect(runPreflight({ source: "", sourceProfile: "none" }).pdfUa).toBeUndefined();
  });

  it("counts only the rules it could actually read on the compiled file", () => {
    const report = runPreflight({
      ...base,
      extraction: { metadata: "ok", markInfo: "ok", structure: "ok", structureFailedPages: [] },
      struct: {
        ...taggedDocument,
        ua: {
          displayDocTitle: true,
          suspects: false,
          xmpTitle: "Accessible document",
          infoTitle: "Accessible document",
          uaPart: null,
          uaRev: null,
          taggedTextRuns: 40,
          untaggedTextRuns: 0,
          artifactTextRuns: 2,
          links: [],
        },
      },
    });
    expect(report.pdfUa?.unavailable).toEqual(["5-1", "5-2"]);
    expect(report.pdfUa?.passed).toBe((report.pdfUa?.covered ?? 0) - 2);
    expect(report.pdfUa?.total).toBe(106);
  });

  it("does not claim a structure rule as verified when the structure never loaded", () => {
    const report = runPreflight({
      ...base,
      meta: { lang: "en-US", title: "Resume", tagged: null },
      struct: { root: null, tagged: null },
      extraction: { metadata: "ok", markInfo: "failed", structure: "failed", structureFailedPages: [2] },
    });
    expect(report.pdfUa?.outcomes["7.3-1"]).toBe("unavailable");
    expect(report.pdfUa?.outcomes["7.1-11"]).toBe("unavailable");
    expect(report.pdfUa?.failed).toEqual([]);
    expect(report.pdfUa?.passed).toBeLessThan(report.pdfUa?.covered ?? 0);
  });

  it("marks the tagging rules failed on an untagged PDF and the rest unavailable", () => {
    const report = runPreflight({
      ...base,
      meta: { lang: "en-US", title: "Resume", tagged: false },
      struct: { root: null, tagged: false },
      extraction: { metadata: "ok", markInfo: "ok", structure: "ok", structureFailedPages: [] },
    });
    expect(report.pdfUa?.failed).toContain("7.1-11");
    expect(report.pdfUa?.outcomes["7.3-1"]).toBe("unavailable");
  });

  it("leaves the marked-content rule unchecked when the structure extraction failed", () => {
    const report = runPreflight({
      ...base,
      struct: { ...taggedDocument, ua: { ...cleanUa } },
      extraction: { metadata: "ok", markInfo: "ok", structure: "failed", structureFailedPages: [2] },
    });
    expect(report.pdfUa?.outcomes["7.1-3"]).toBe("unavailable");
    for (const rule of ["7.3-1", "7.4.2-1", "7.5-1", "7.5-2"]) {
      expect(report.pdfUa?.outcomes[rule], rule).toBe("unavailable");
    }
    expect(report.pdfUa?.failed).toEqual([]);
  });

  it("leaves the viewer and link rules unchecked on an untagged PDF instead of passing them", () => {
    const report = runPreflight({
      ...base,
      meta: { lang: "en-US", title: "Resume", tagged: false },
      struct: {
        root: null,
        tagged: false,
        ua: { ...cleanUa, displayDocTitle: false, links: [{ hasContents: false }] },
      },
      extraction: everythingRead,
    });
    expect(report.findings.map((finding) => finding.id)).toEqual(["pdf-untagged-output"]);
    expect(report.pdfUa?.outcomes["7.1-10"]).toBe("unavailable");
    expect(report.pdfUa?.outcomes["7.18.5-2"]).toBe("unavailable");
    expect(report.pdfUa?.outcomes["7.1-3"]).toBe("unavailable");
    expect(report.pdfUa?.outcomes["7.1-4"]).toBe("unavailable");
    expect(report.pdfUa?.failed).toContain("7.1-11");
  });

  it("verifies every rule it read on a tagged PDF that comes back clean", () => {
    const report = runPreflight({
      ...base,
      struct: { ...taggedDocument, ua: { ...cleanUa, uaPart: 1 } },
      extraction: everythingRead,
    });
    expect(report.findings).toEqual([]);
    expect(report.pdfUa?.unavailable).toEqual([]);
    expect(report.pdfUa?.failed).toEqual([]);
    expect(report.pdfUa?.passed).toBe(report.pdfUa?.covered);
  });

  it("fails the viewer rule, and only that rule, when DisplayDocTitle is off", () => {
    const report = runPreflight({
      ...base,
      struct: { ...taggedDocument, ua: { ...cleanUa, displayDocTitle: false } },
      extraction: everythingRead,
    });
    expect(report.findings.map((finding) => finding.id)).toEqual(["pdf-display-doc-title"]);
    expect(report.pdfUa?.failed).toEqual(["7.1-10"]);
    expect(report.pdfUa?.unavailable).toEqual(["5-1", "5-2"]);
    expect(report.pdfUa?.passed).toBe((report.pdfUa?.covered ?? 0) - 3);
  });

  it("leaves the identification rules unchecked when the file declares PDF/UA-2", () => {
    const report = runPreflight({
      ...base,
      struct: { ...taggedDocument, ua: { ...cleanUa, uaPart: 2 } },
      extraction: everythingRead,
    });
    expect(report.findings).toEqual([]);
    expect(report.pdfUa?.outcomes["5-1"]).toBe("unavailable");
    expect(report.pdfUa?.outcomes["5-2"]).toBe("unavailable");
  });

  it("keeps the untagged verdict as one informational finding with an honest remedy", () => {
    const report = runPreflight({
      ...base,
      meta: { lang: "en-US", title: "Resume", tagged: false },
      struct: { root: null, tagged: false },
    });
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: "pdf-untagged-output",
        severity: "info",
        detail: expect.stringContaining("cannot satisfy PDF/UA-1 clause 7.1"),
      }),
    ]);
  });
});
