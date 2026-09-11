import { annotate } from "./standards";
import type { Finding, PdfFacts } from "./types";

export interface CompileContext {
  status: "idle" | "success" | "error" | "unavailable";
  log: string;
}

function finding(
  id: string,
  severity: Finding["severity"],
  title: string,
  detail: string,
): Finding {
  return annotate({ id, lens: "compile", severity, title, detail, certainty: "verified" }, "compile-log");
}

const REPORT_START = /^\s*Status\s+report\s+of\s+the\s+tagging\s+support\s*$/i;
const REPORT_END = /^\s*End\s+of\s+status\s+report\s*$/i;
const CLASS_LINE = /^\s*(\S+\.cls)\s+is\s+(.+?)\s*$/;
const SECTION_LINE = /^\s*([1-6])\.\s+(\S.*?)\s*$/;
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
    if (section) {
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
  const sentences = [
    classProblem && report.documentClass
      ? `The ${report.documentClass.name} class is ${report.documentClass.status}.`
      : null,
    blocking.length > 0
      ? `Not compatible with tagging: ${blocking.slice(0, 8).join(", ")}.`
      : null,
    unproven.length > 0 ? `No recorded verdict for: ${unproven.slice(0, 8).join(", ")}.` : null,
    report.groups.partial.length > 0
      ? `Tagging only in part: ${report.groups.partial.slice(0, 8).join(", ")}.`
      : null,
  ].filter((sentence): sentence is string => sentence !== null);
  const flagged = (classProblem ? 1 : 0) + blocking.length + unproven.length;
  return [
    annotate(
      {
        id: "output-tagging-status",
        lens: "a11y",
        severity: "warning",
        title: `The tagging status report flagged ${flagged} item${flagged === 1 ? "" : "s"}`,
        detail: `LaTeX wrote its own tagging status report at the end of the build. ${sentences.join(" ")} Anything that cannot tag can leave whole sections out of the structure tree, so replace what you can.`,
        certainty: "verified",
      },
      "compile-log",
    ),
  ];
}

function taggingLogFindings(logLines: readonly string[]): Finding[] {
  const out: Finding[] = [];
  const warnings = logLines
    .map((line) => /Package tagpdf Warning:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((message): message is string => Boolean(message));
  const unique = [...new Set(warnings)];
  if (unique.length > 0) {
    out.push(
      annotate(
        {
          id: "output-tagpdf-warning",
          lens: "a11y",
          severity: "warning",
          title: `Tagging reported ${unique.length} problem${unique.length === 1 ? "" : "s"}`,
          detail: `The tagging code wrote these warnings to the log: ${unique.slice(0, 5).join(" ")} Each one is a place where the structure tree does not match the content. Fix them at the source and compile again.`,
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
        "The latest compilation failed",
        "Submission output must come from a successful build. Fix the first compiler error, compile again, and rerun Preflight.",
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
        `${overfull.length} overfull line${overfull.length === 1 ? "" : "s"} in the output`,
        `The compiler reports content extending beyond its text box, up to ${widest.toFixed(1)} pt. Inspect these locations for clipped text, equations, tables, or links.`,
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
        `${missingGlyphs.length} missing glyph${missingGlyphs.length === 1 ? "" : "s"}`,
        "The selected fonts cannot render every character. Missing glyphs can silently disappear from the PDF, including symbols in names, equations, and citations.",
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
        "The compiled output has unresolved references",
        "At least one citation or cross-reference remained unresolved after compilation. The submitted PDF may contain [?] or ??. Check the log and run the required bibliography and LaTeX passes.",
      ),
    );
  }

  if (/Label\(s\) may have changed|Rerun to get cross-references right|Please \(re\)run (?:Biber|BibTeX)/i.test(log)) {
    out.push(
      finding(
        "compile-rerun-required",
        "warning",
        "Another compilation pass is required",
        "The latest log says labels, citations, or the table of contents are not settled. Recompile until the rerun warning disappears before exporting.",
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
        "Duplicate PDF destinations",
        "Two anchors share the same destination, so links or bookmarks can jump to the wrong place. This commonly comes from duplicate labels or page numbering resets.",
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
          "Mixed page sizes in one PDF",
          `The PDF contains ${sizes.length} page sizes (${sizes.join(", ")}). Mixed media boxes often indicate an incorrectly included page or figure and can fail publisher production checks.`,
        ),
      );
    }
  }

  out.push(...taggingLogFindings(logLines));

  return out;
}
