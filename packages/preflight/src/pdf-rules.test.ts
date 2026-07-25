import { describe, it, expect } from "vitest";
import {
  analyzeReadingOrder,
  detectGarbledText,
  checkSelectability,
  catalogFindings,
  runPdfRules,
} from "./pdf-rules";
import type { PositionedText } from "./types";

const t = (str: string, x: number, y: number, width = 20): PositionedText => ({ str, x, y, width });

describe("analyzeReadingOrder", () => {
  it("flags a page where two x-columns share the same visual rows", () => {
    // Left and right column text on the same y bands => merged/scrambled.
    const page: PositionedText[] = [
      t("Acme Corp", 0, 100),
      t("+1 555 0100", 300, 100),
      t("Engineer", 0, 80),
      t("jane@doe.com", 300, 80),
    ];
    expect(analyzeReadingOrder([page]).some((f) => f.id === "pdf-reading-order")).toBe(true);
  });

  it("does not flag a clean single column", () => {
    const page: PositionedText[] = [t("Acme Corp", 0, 100), t("Engineer", 0, 80), t("2020-2024", 0, 60)];
    expect(analyzeReadingOrder([page]).some((f) => f.id === "pdf-reading-order")).toBe(false);
  });
});

describe("detectGarbledText", () => {
  it("flags the Unicode replacement character", () => {
    expect(detectGarbledText("Software Engi�eer").length).toBeGreaterThan(0);
  });
  it("flags unmapped (cid:NNN) glyph markers", () => {
    expect(detectGarbledText("see (cid:415) here").length).toBeGreaterThan(0);
  });
  it("passes clean text", () => {
    expect(detectGarbledText("Software Engineer")).toHaveLength(0);
  });
});

describe("checkSelectability", () => {
  it("flags a page with no extractable text (vector image / scan)", () => {
    expect(checkSelectability([[]]).some((f) => f.id === "pdf-selectable")).toBe(true);
  });
  it("does not flag a page with real text", () => {
    expect(checkSelectability([[t("real content here", 0, 100)]]).some((f) => f.id === "pdf-selectable")).toBe(false);
  });
});

describe("catalogFindings", () => {
  it("warns when the PDF has no language", () => {
    expect(catalogFindings({ lang: null, title: "CV", tagged: false }).some((f) => f.id === "pdf-lang-title")).toBe(true);
  });
  it("warns when the PDF has no title", () => {
    expect(catalogFindings({ lang: "en", title: null, tagged: false }).some((f) => f.id === "pdf-lang-title")).toBe(true);
  });
  it("is quiet when language and title are present", () => {
    expect(catalogFindings({ lang: "en", title: "CV", tagged: true }).some((f) => f.id === "pdf-lang-title")).toBe(false);
  });
  it("leaves the structure-tree checker as the single owner of tagging verdicts", () => {
    const fs = catalogFindings({ lang: "en", title: "CV", tagged: false });
    expect(fs.some((f) => f.id === "pdf-tagged")).toBe(false);
    expect(fs.some((f) => f.id === "pdf-untagged-output")).toBe(false);
  });
  it("does not add the not-tagged note when the PDF is tagged", () => {
    expect(catalogFindings({ lang: "en", title: "CV", tagged: true }).some((f) => f.id === "pdf-tagged")).toBe(false);
  });
});

describe("runPdfRules", () => {
  it("combines reading-order, garble, selectability, and catalog findings", () => {
    const page: PositionedText[] = [t("Acme", 0, 100), t("Corp�", 300, 100)];
    const findings = runPdfRules([page], { lang: null, title: null, tagged: false });
    const ids = new Set(findings.map((f) => f.id));
    expect(ids.has("pdf-reading-order")).toBe(true);
    expect(ids.has("pdf-garbled")).toBe(true);
    expect(ids.has("pdf-lang-title")).toBe(true);
  });
});
