import { describe, expect, it } from "vitest";
import { runCompileRules } from "./compile-rules";
import type { PdfFacts } from "./types";

const pdf = (over: Partial<PdfFacts> = {}): PdfFacts => ({
  version: "1.7",
  pageCount: 1,
  pages: [{ width: 612, height: 792, rotation: 0 }],
  outlineCount: 0,
  linkCount: 0,
  attachmentCount: 0,
  formFieldCount: 0,
  restricted: false,
  author: null,
  creator: null,
  producer: null,
  fonts: [],
  ...over,
});

describe("compile preflight rules", () => {
  it("reports a failed latest build", () => {
    const findings = runCompileRules({ status: "error", log: "! Undefined control sequence" });
    expect(findings).toContainEqual(expect.objectContaining({ id: "compile-failed", severity: "error" }));
  });

  it("summarizes overfull boxes and escalates severe overflow", () => {
    const findings = runCompileRules({
      status: "success",
      log: "Overfull \\hbox (2.0pt too wide)\nOverfull \\hbox (18.5pt too wide)",
    });
    expect(findings).toContainEqual(expect.objectContaining({
      id: "compile-overfull-box",
      severity: "error",
      title: expect.stringContaining("2 overfull lines"),
    }));
  });

  it("detects unsettled references and required reruns", () => {
    const ids = runCompileRules({
      status: "success",
      log: "LaTeX Warning: There were undefined references.\nLaTeX Warning: Rerun to get cross-references right.",
    }).map((finding) => finding.id);
    expect(ids).toContain("compile-unresolved-references");
    expect(ids).toContain("compile-rerun-required");
  });

  it("detects line-oriented glyph, reference, and destination warnings", () => {
    const ids = runCompileRules({
      status: "success",
      log: [
        "Missing character: There is no Ω in font CMR10!",
        "LaTeX Warning: Reference `sec:missing' on page 2 undefined on input line 18.",
        "pdfTeX warning: destination with the same identifier (name{page.1}) has been already used, duplicate ignored",
      ].join("\n"),
    }).map((finding) => finding.id);
    expect(ids).toEqual(expect.arrayContaining([
      "compile-missing-glyph",
      "compile-unresolved-references",
      "compile-duplicate-destination",
    ]));
  });

  it("reports mixed PDF media sizes", () => {
    const findings = runCompileRules(undefined, pdf({
      pageCount: 2,
      pages: [
        { width: 612, height: 792, rotation: 0 },
        { width: 595.3, height: 841.9, rotation: 0 },
      ],
    }));
    expect(findings).toContainEqual(expect.objectContaining({ id: "compile-mixed-page-sizes" }));
  });
});
