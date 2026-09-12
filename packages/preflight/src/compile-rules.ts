import { annotate } from "./standards";
import { message, type MessageRef } from "./messages";
import type { Finding, PdfFacts } from "./types";

export interface CompileContext {
  status: "idle" | "success" | "error" | "unavailable";
  log: string;
}

function finding(
  id: string,
  severity: Finding["severity"],
  title: MessageRef,
  detail: MessageRef,
): Finding {
  return annotate({ id, lens: "compile", severity, title, detail, certainty: "verified" }, "compile-log");
}

const REPORT_START = /^\s*Status\s+report\s+of\s+the\s+tagging\s+support\s*$/i;
const REPORT_END = /^\s*End\s+of\s+status\s+report\s*$/i;
const CLASS_LINE = /^\s*(\S+\.cls)\s+is\s(.*)$/;
const SECTION_LINE = /^\s*([1-6])\.\s(.*)$/;
const TAGPDF_WARNING = "Package tagpdf Warning:";
const FILE_LINE = /^\s*(\S+\.(?:sty|def|ldf|cfg|tex|clo|cls))\s*$/;

export type TaggingStatusGroup =
  | "unsupported"
  | "incompatible"
  | "partial"
  | "compatible"
  | "unknown"
  | "unclassified";

export interface TaggingStatusReport {
  documentClass: { name: string; status: string } | null;
  groups: Record<TaggingStatusGroup, string[]>;
}

const GROUP_BY_SECTION: Record<string, TaggingStatusGroup> = {
  "1": "unsupported",
  "2": "incompatible",
  "3": "partial",
  "4": "compatible",
  "5": "unknown",
  "6": "unclassified",
};

const CLEAN_CLASS_STATUS = new Set(["compatible"]);

export function parseTaggingStatusReport(logLines: readonly string[]): TaggingStatusReport | null {
  const start = logLines.findIndex((line) => REPORT_START.test(line));
  if (start === -1) return null;
  const report: TaggingStatusReport = {
    documentClass: null,
    groups: {
      unsupported: [],
      incompatible: [],
      partial: [],
      compatible: [],
      unknown: [],
      unclassified: [],
    },
  };
  let group: TaggingStatusGroup | null = null;
  for (let i = start + 1; i < logLines.length; i++) {
    const line = logLines[i];
    if (REPORT_END.test(line)) break;
    const section = SECTION_LINE.exec(line);
    if (section?.[2].trim()) {
      group = GROUP_BY_SECTION[section[1]] ?? null;
      continue;
    }
    if (!report.documentClass) {
      const klass = CLASS_LINE.exec(line);
      if (klass) {
        report.documentClass = { name: klass[1], status: klass[2].trim() };
        continue;
      }
    }
    const file = FILE_LINE.exec(line);
    if (file && group) report.groups[group].push(file[1]);
  }
  return report;
}

function taggingStatusFinding(report: TaggingStatusReport): Finding[] {
  const classStatus = report.documentClass?.status.toLowerCase() ?? null;
  const classProblem = classStatus !== null && !CLEAN_CLASS_STATUS.has(classStatus);
  const blocking = [...report.groups.unsupported, ...report.groups.incompatible];
  const unproven = [...report.groups.unknown, ...report.groups.unclassified];
  if (!classProblem && blocking.length === 0 && unproven.length === 0) return [];
  const parts: MessageRef[] = [
    classProblem && report.documentClass
      ? message("rules.output-tagging-status.partClass", {
          name: report.documentClass.name,
          status: report.documentClass.status,
        })
      : null,
    blocking.length > 0
      ? message("rules.output-tagging-status.partBlocking", { files: blocking.slice(0, 8).join(", ") })
      : null,
    unproven.length > 0
      ? message("rules.output-tagging-status.partUnproven", { files: unproven.slice(0, 8).join(", ") })
      : null,
    report.groups.partial.length > 0
      ? message("rules.output-tagging-status.partPartial", {
          files: report.groups.partial.slice(0, 8).join(", "),
        })
      : null,
  ].filter((part): part is MessageRef => part !== null);
  const flagged = (classProblem ? 1 : 0) + blocking.length + unproven.length;
  return [
    annotate(
      {
        id: "output-tagging-status",
        lens: "a11y",
        severity: "warning",
        title: message("rules.output-tagging-status.title", { count: flagged }),
        detail: message("rules.output-tagging-status.detail"),
        detailParts: [...parts, message("rules.output-tagging-status.partAdvice")],
        certainty: "verified",
      },
      "compile-log",
    ),
  ];
}

function taggingLogFindings(logLines: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const warnings = logLines
    .map((line) => {
      const at = line.indexOf(TAGPDF_WARNING);
      return at === -1 ? undefined : line.slice(at + TAGPDF_WARNING.length).trim();
    })
    .filter((message): message is string => Boolean(message));
  const unique = [...new Set(warnings)];
  if (unique.length > 0) {
    out.push(
      annotate(
        {
          id: "output-tagpdf-warning",
          lens: "a11y",
          severity: "warning",
          title: message("rules.output-tagpdf-warning.title", { count: unique.length }),
          detail: message("rules.output-tagpdf-warning.detail", { warnings: unique.slice(0, 5).join(" ") }),
          certainty: "verified",
        },
        "compile-log",
      ),
    );
  }
  const report = parseTaggingStatusReport(logLines);
  if (report) out.push(...taggingStatusFinding(report));
  return out;
}

function distinctPageSizes(pdf: PdfFacts): string[] {
  const sizes = new Set<string>();
  for (const page of pdf.pages) {
    const width = Math.round(page.width * 10) / 10;
    const height = Math.round(page.height * 10) / 10;
    sizes.add(`${width} × ${height}`);
  }
  return [...sizes];
}

export function runCompileRules(context?: CompileContext, pdf?: PdfFacts): Finding[] {
  const out: Finding[] = [];
  const log = context?.log ?? "";
  const logLines = log.split("\n");
  const lowerLog = log.toLowerCase();

  if (context?.status === "error") {
    out.push(
      finding(
        "compile-failed",
        "error",
        message("rules.compile-failed.title"),
        message("rules.compile-failed.detail"),
      ),
    );
  }

  const overfull = [...log.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)/gi)].map((match) => Number(match[1]));
  if (overfull.length > 0) {
    const widest = Math.max(...overfull);
    out.push(
      finding(
        "compile-overfull-box",
        widest >= 10 ? "error" : "warning",
        message("rules.compile-overfull-box.title", { count: overfull.length }),
        message("rules.compile-overfull-box.detail", { width: widest.toFixed(1) }),
      ),
    );
  }

  const missingGlyphs = logLines.filter((line) => {
    const lower = line.toLowerCase();
    return lower.includes("missing character:") && lower.includes("there is no ");
  });
  if (missingGlyphs.length > 0) {
    out.push(
      finding(
        "compile-missing-glyph",
        "error",
        message("rules.compile-missing-glyph.title", { count: missingGlyphs.length }),
        message("rules.compile-missing-glyph.detail"),
      ),
    );
  }

  const hasUndefinedReference =
    lowerLog.includes("there were undefined references") ||
    lowerLog.includes("undefined citation") ||
    logLines.some((line) => {
      const lower = line.toLowerCase();
      return lower.includes("reference ") && lower.includes(" on page ") && lower.includes(" undefined");
    });
  if (hasUndefinedReference) {
    out.push(
      finding(
        "compile-unresolved-references",
        "error",
        message("rules.compile-unresolved-references.title"),
        message("rules.compile-unresolved-references.detail"),
      ),
    );
  }

  if (/Label\(s\) may have changed|Rerun to get cross-references right|Please \(re\)run (?:Biber|BibTeX)/i.test(log)) {
    out.push(
      finding(
        "compile-rerun-required",
        "warning",
        message("rules.compile-rerun-required.title"),
        message("rules.compile-rerun-required.detail"),
      ),
    );
  }

  const hasDuplicateDestination = logLines.some((line) => {
    const lower = line.toLowerCase();
    return lower.includes("destination with the same identifier") && lower.includes("duplicate ignored");
  });
  if (hasDuplicateDestination) {
    out.push(
      finding(
        "compile-duplicate-destination",
        "warning",
        message("rules.compile-duplicate-destination.title"),
        message("rules.compile-duplicate-destination.detail"),
      ),
    );
  }

  if (pdf) {
    const sizes = distinctPageSizes(pdf);
    if (sizes.length > 1) {
      out.push(
        finding(
          "compile-mixed-page-sizes",
          "warning",
          message("rules.compile-mixed-page-sizes.title"),
          message("rules.compile-mixed-page-sizes.detail", { count: sizes.length, sizes: sizes.join(", ") }),
        ),
      );
    }
  }

  out.push(...taggingLogFindings(logLines));

  return out;
}
