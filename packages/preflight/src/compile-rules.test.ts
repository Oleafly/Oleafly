import { describe, expect, it } from "vitest";
import { parseTaggingStatusReport, runCompileRules } from "./compile-rules";
import type { PdfFacts } from "./types";

function statusReport(options: {
  documentClass: string;
  classStatus: string;
  unsupported?: string[];
  incompatible?: string[];
  partial?: string[];
  compatible?: string[];
  unknown?: string[];
  unclassified?: string[];
}): string {
  const group = (title: string, names: string[] | undefined) => [
    `  ${title}`,
    "  --------------------------",
    ...(names && names.length > 0 ? names.map((name) => `  ${name}`) : ["  NONE"]),
    "",
  ];
  return [
    "",
    "======================================",
    "  Status report of the tagging support",
    "======================================",
    "  Details at https://latex3.github.io/tagging-project/tagging-status",
    "  Report erroneous entries at https://github.com/latex3/tagging-project",
    "",
    "  A. CLASS",
    "  ********",
    "",
    `  ${options.documentClass} is ${options.classStatus}`,
    "",
    "  B. PACKAGES, LIBRARIES, etc",
    "  ***********",
    "",
    ...group("1. Unsupported", options.unsupported),
    ...group("2. Currently incompatible", options.incompatible),
    ...group("3. Partially compatible", options.partial),
    ...group("4. Compatible", options.compatible),
    ...group("5. Unknown", options.unknown),
    ...group("6. Unclassified files with extension .sty", options.unclassified),
    "====================================",
    "  End of status report",
    "====================================",
  ].join("\n");
}

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
      title: { key: "rules.compile-overfull-box.title", params: { count: 2 } },
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

describe("tagging log channel", () => {
  it("collects tagpdf warnings into one accessibility finding", () => {
    const findings = runCompileRules({
      status: "success",
      log: [
        "Package tagpdf Warning: Alternative text for graphic is missing.",
        "Package tagpdf Warning: Alternative text for graphic is missing.",
        "Package tagpdf Warning: The package unicode-math is missing",
      ].join("\n"),
    });
    const tagging = findings.find((finding) => finding.id === "output-tagpdf-warning");
    expect(tagging?.lens).toBe("a11y");
    expect(tagging?.severity).toBe("warning");
    expect(tagging?.method).toBe("compile-log");
    expect(tagging?.title).toEqual({
      key: "rules.output-tagpdf-warning.title",
      params: { count: 2 },
    });
    expect(tagging?.detail.key).toBe("rules.output-tagpdf-warning.detail");
    expect(tagging?.detail.params?.warnings).toContain("Alternative text for graphic is missing.");
    expect(tagging?.standards?.length).toBeGreaterThan(0);
  });

  it("parses the report block LaTeX actually writes at the end of the build", () => {
    const report = parseTaggingStatusReport(
      statusReport({
        documentClass: "acmart.cls",
        classStatus: "partially compatible",
        incompatible: ["float.sty", "caption.sty"],
        partial: ["hyperref.sty"],
        compatible: ["booktabs.sty"],
        unclassified: ["mylocal.sty"],
      }).split("\n"),
    );
    expect(report?.documentClass).toEqual({ name: "acmart.cls", status: "partially compatible" });
    expect(report?.groups.incompatible).toEqual(["float.sty", "caption.sty"]);
    expect(report?.groups.partial).toEqual(["hyperref.sty"]);
    expect(report?.groups.compatible).toEqual(["booktabs.sty"]);
    expect(report?.groups.unsupported).toEqual([]);
    expect(report?.groups.unknown).toEqual([]);
    expect(report?.groups.unclassified).toEqual(["mylocal.sty"]);
  });

  it("reports the tagging status check when the report names something incompatible", () => {
    const findings = runCompileRules({
      status: "success",
      log: statusReport({
        documentClass: "acmart.cls",
        classStatus: "partially compatible",
        incompatible: ["float.sty", "caption.sty"],
        unknown: ["mystery.sty"],
      }),
    });
    const status = findings.find((finding) => finding.id === "output-tagging-status");
    expect(status?.lens).toBe("a11y");
    expect(status?.severity).toBe("warning");
    expect(status?.method).toBe("compile-log");
    expect(status?.title).toEqual({
      key: "rules.output-tagging-status.title",
      params: { count: 4 },
    });
    expect(status?.detail.key).toBe("rules.output-tagging-status.detail");
    expect(status?.detailParts).toEqual([
      {
        key: "rules.output-tagging-status.partClass",
        params: { name: "acmart.cls", status: "partially compatible" },
      },
      {
        key: "rules.output-tagging-status.partBlocking",
        params: { files: "float.sty, caption.sty" },
      },
      { key: "rules.output-tagging-status.partUnproven", params: { files: "mystery.sty" } },
      { key: "rules.output-tagging-status.partAdvice" },
    ]);
  });

  it("names an unsupported class from the report", () => {
    const status = runCompileRules({
      status: "success",
      log: statusReport({ documentClass: "beamer.cls", classStatus: "unsupported" }),
    }).find((finding) => finding.id === "output-tagging-status");
    expect(status?.detailParts?.[0]).toEqual({
      key: "rules.output-tagging-status.partClass",
      params: { name: "beamer.cls", status: "unsupported" },
    });
  });

  it("stays quiet when the report has nothing to fix", () => {
    const ids = runCompileRules({
      status: "success",
      log: statusReport({
        documentClass: "article.cls",
        classStatus: "compatible",
        partial: ["hyperref.sty"],
        compatible: ["booktabs.sty", "graphicx.sty"],
      }),
    }).map((finding) => finding.id);
    expect(ids).not.toContain("output-tagging-status");
    expect(ids).not.toContain("output-tagpdf-warning");
  });

  it("stays quiet when the log carries no report at all", () => {
    expect(parseTaggingStatusReport(["This is a normal log line"])).toBeNull();
    expect(
      runCompileRules({ status: "success", log: "This is a normal log line" }).map((f) => f.id),
    ).not.toContain("output-tagging-status");
  });

  it("marks the existing compile findings as log readings", () => {
    const findings = runCompileRules({ status: "error", log: "! Undefined control sequence" });
    expect(findings.every((finding) => finding.method === "compile-log")).toBe(true);
  });
});
