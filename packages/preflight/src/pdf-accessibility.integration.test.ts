import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "./engine";
import type { StructDoc } from "./structure";
import type { PositionedText } from "./types";

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
    children: [{ role: "P", alt: null, lang: null, children: [] }],
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

  it("keeps the Tectonic untagged limitation as one informational verdict", () => {
    const report = runPreflight({
      ...base,
      meta: { lang: "en-US", title: "Resume", tagged: false },
      struct: { root: null, tagged: false },
    });
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: "pdf-untagged-output",
        severity: "info",
        detail: expect.stringContaining("current compile engine does not produce tags"),
      }),
    ]);
  });
});
