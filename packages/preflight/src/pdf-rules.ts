import { submissionProfile, type SubmissionProfileId } from "./profiles";
import type { Finding, PdfExtractionStatus, PdfFacts, PositionedText } from "./types";

// Rows within this many PDF units of each other count as the same visual line.
const ROW_TOLERANCE = 3;
// A horizontal gap this wide (about one inch at 72dpi) between two runs on the
// same line signals a column break, i.e. two columns merged into one row.
const COLUMN_GAP = 72;

export function analyzeReadingOrder(pages: PositionedText[][]): Finding[] {
  const out: Finding[] = [];
  pages.forEach((items, pageIdx) => {
    const rows = new Map<number, PositionedText[]>();
    for (const it of items) {
      if (!it.str.trim()) continue;
      let key: number | null = null;
      for (const k of rows.keys()) {
        if (Math.abs(k - it.y) <= ROW_TOLERANCE) {
          key = k;
          break;
        }
      }
      if (key === null) key = it.y;
      const arr = rows.get(key) ?? [];
      arr.push(it);
      rows.set(key, arr);
    }
    const merged = [...rows.values()].some((row) => {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
        if (gap > COLUMN_GAP) return true;
      }
      return false;
    });
    if (merged) {
      out.push({
        id: "pdf-reading-order",
        lens: "both",
        severity: "error",
        title: "Columns read across in the output",
        detail:
          "On this page the text of two columns lands on the same lines, so a parser reads them straight across into scrambled text and a screen reader announces them out of order. Use a single-column layout for content that must be parsed. See the reader view below.",
        page: pageIdx + 1,
      });
    }
  });
  return out;
}

export function detectGarbledText(text: string): Finding[] {
  const hasReplacement = text.includes("�");
  const hasCid = /\(cid:\d+\)/i.test(text);
  if (!hasReplacement && !hasCid) return [];
  return [
    {
      id: "pdf-garbled",
      lens: "both",
      severity: "error",
      title: "Garbled or unmapped text in the output",
      detail:
        "The extracted text contains characters that did not map to Unicode, so copy-paste and parsers see garbled output and a screen reader cannot read it. This usually means a missing glyph-to-Unicode map or a font that is not embedded as text.",
    },
  ];
}

export function checkSelectability(pages: PositionedText[][]): Finding[] {
  const out: Finding[] = [];
  pages.forEach((items, pageIdx) => {
    const chars = items.reduce((n, it) => n + it.str.trim().length, 0);
    if (chars < 3) {
      out.push({
        id: "pdf-selectable",
        lens: "both",
        severity: "error",
        title: "Page has no selectable text",
        detail:
          "This page contains little or no extractable text, so a parser and a screen reader see nothing. It is likely rendered as an image or uses fonts that are not embedded as text. Make sure the content is real, selectable text.",
        page: pageIdx + 1,
      });
    }
  });
  return out;
}

export function outputGeometryFindings(pages: PositionedText[][], facts?: PdfFacts): Finding[] {
  const out: Finding[] = [];
  let tinyRuns = 0;
  let measuredRuns = 0;
  pages.forEach((items, pageIdx) => {
    const page = facts?.pages[pageIdx];
    let outside = false;
    for (const item of items) {
      if (!item.str.trim()) continue;
      if (item.height && item.height > 0) {
        measuredRuns++;
        if (item.height < 7) tinyRuns++;
      }
      if (
        page &&
        page.rotation % 360 === 0 &&
        (item.x < -1 || item.x + item.width > page.width + 1 || item.y < -1 || item.y > page.height + 1)
      ) {
        outside = true;
      }
    }
    if (outside) {
      out.push({
        id: "output-clipped-content",
        lens: "compile",
        severity: "error",
        title: "Text extends outside the page",
        detail:
          "Selectable text lies beyond this page's media box and may be clipped or missing in print and publisher processing. Inspect wide equations, tables, URLs, and positioned content.",
        page: pageIdx + 1,
        certainty: "verified",
      });
    }
  });
  if (measuredRuns >= 20 && tinyRuns / measuredRuns >= 0.05) {
    out.push({
      id: "output-small-text",
      lens: "a11y",
      severity: "warning",
      title: "Very small text detected",
      detail:
        `${tinyRuns} text runs measure below approximately 7 pt. Small type is difficult to read in print and at normal zoom. Confirm that the venue permits it and increase nonessentially small labels or footnotes.`,
      certainty: "advisory",
    });
  }
  return out;
}

function navigationFindings(facts: PdfFacts | undefined, profileId: SubmissionProfileId): Finding[] {
  if (!facts || facts.pageCount < 10 || facts.outlineCount > 0 || submissionProfile(profileId).pdf.forbidBookmarks) return [];
  return [{
    id: "pdf-no-bookmarks",
    lens: "a11y",
    severity: "warning",
    title: "Long PDF has no bookmarks",
    detail:
      "Long documents should expose a hierarchical bookmark outline so keyboard and assistive-technology users can navigate sections without reading every page in sequence.",
    certainty: "verified",
  }];
}

export function catalogFindings(
  meta: { lang?: string | null; title?: string | null; tagged?: boolean | null },
  extraction?: Pick<PdfExtractionStatus, "metadata" | "markInfo">,
): Finding[] {
  const out: Finding[] = [];
  if (extraction?.metadata === "failed") {
    out.push({
      id: "pdf-metadata-extraction-failed",
      lens: "a11y",
      severity: "info",
      title: "PDF metadata could not be inspected",
      detail:
        "Preflight could not read the PDF metadata, so it cannot verify the document title or language. This is an unknown result, not evidence that those fields are missing. Recompile and run the check again.",
    });
  } else if (!meta.lang || !meta.title) {
    const missing = [!meta.lang && "language", !meta.title && "title"].filter(Boolean).join(" and ");
    out.push({
      id: "pdf-lang-title",
      lens: "a11y",
      severity: "warning",
      title: `PDF is missing a ${missing}`,
      detail:
        "Assistive tech and browsers use the PDF's language and title to announce the document correctly. Set them with hyperref, for example \\hypersetup{pdftitle={Your Name, CV}, pdflang=en-US}.",
    });
  }
  if (extraction?.markInfo === "failed" && meta.tagged !== true) {
    out.push({
      id: "pdf-mark-info-extraction-failed",
      lens: "a11y",
      severity: "info",
      title: "PDF tagging status could not be inspected",
      detail:
        "Preflight could not read the PDF's MarkInfo dictionary, so it will not claim that the output is tagged or untagged from that check alone.",
    });
  }
  return out;
}

export function runPdfRules(
  pages: PositionedText[][],
  meta?: { lang?: string | null; title?: string | null; tagged?: boolean | null },
  extraction?: Pick<PdfExtractionStatus, "metadata" | "markInfo">,
  facts?: PdfFacts,
  profileId: SubmissionProfileId = "generic",
): Finding[] {
  const text = pages.map((p) => p.map((it) => it.str).join("")).join("\n");
  return [
    ...analyzeReadingOrder(pages),
    ...detectGarbledText(text),
    ...checkSelectability(pages),
    ...outputGeometryFindings(pages, facts),
    ...(meta ? catalogFindings(meta, extraction) : []),
    ...navigationFindings(facts, profileId),
  ];
}
