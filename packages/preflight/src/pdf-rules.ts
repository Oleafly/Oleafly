import { submissionProfile, type SubmissionProfileId } from "./profiles";
import { annotate, standardsFor } from "./standards";
import { message } from "./messages";
import type { Finding, PdfExtractionStatus, PdfFacts, PositionedText, StandardRef } from "./types";

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
      out.push(
        annotate(
          {
            id: "pdf-reading-order",
            lens: "both",
            severity: "error",
            title: message("rules.pdf-reading-order.title"),
            detail: message("rules.pdf-reading-order.detail"),
            page: pageIdx + 1,
          },
          "layout-heuristic",
        ),
      );
    }
  });
  return out;
}

export function detectGarbledText(text: string): Finding[] {
  const hasReplacement = text.includes("�");
  const hasCid = /\(cid:\d+\)/i.test(text);
  if (!hasReplacement && !hasCid) return [];
  return [
    annotate(
      {
        id: "pdf-garbled",
        lens: "both",
        severity: "error",
        title: message("rules.pdf-garbled.title"),
        detail: message("rules.pdf-garbled.detail"),
      },
      "pdf-object-model",
    ),
  ];
}

export function checkSelectability(pages: PositionedText[][]): Finding[] {
  const out: Finding[] = [];
  pages.forEach((items, pageIdx) => {
    const chars = items.reduce((n, it) => n + it.str.trim().length, 0);
    if (chars < 3) {
      out.push(
        annotate(
          {
            id: "pdf-selectable",
            lens: "both",
            severity: "error",
            title: message("rules.pdf-selectable.title"),
            detail: message("rules.pdf-selectable.detail"),
            page: pageIdx + 1,
          },
          "pdf-object-model",
        ),
      );
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
      out.push(
        annotate(
          {
            id: "output-clipped-content",
            lens: "compile",
            severity: "error",
            title: message("rules.output-clipped-content.title"),
            detail: message("rules.output-clipped-content.detail"),
            page: pageIdx + 1,
            certainty: "verified",
          },
          "layout-heuristic",
        ),
      );
    }
  });
  if (measuredRuns >= 20 && tinyRuns / measuredRuns >= 0.05) {
    out.push(
      annotate(
        {
          id: "output-small-text",
          lens: "a11y",
          severity: "warning",
          title: message("rules.output-small-text.title"),
          detail: message("rules.output-small-text.detail", { count: tinyRuns }),
          certainty: "advisory",
        },
        "layout-heuristic",
      ),
    );
  }
  return out;
}

function navigationFindings(facts: PdfFacts | undefined, profileId: SubmissionProfileId): Finding[] {
  if (!facts || facts.pageCount < 10 || facts.outlineCount > 0 || submissionProfile(profileId).pdf.forbidBookmarks) return [];
  return [
    annotate(
      {
        id: "pdf-no-bookmarks",
        lens: "a11y",
        severity: "warning",
        title: message("rules.pdf-no-bookmarks.title"),
        detail: message("rules.pdf-no-bookmarks.detail"),
        certainty: "verified",
      },
      "pdf-object-model",
    ),
  ];
}

export function catalogFindings(
  meta: { lang?: string | null; title?: string | null; tagged?: boolean | null },
  extraction?: Pick<PdfExtractionStatus, "metadata" | "markInfo">,
): Finding[] {
  const out: Finding[] = [];
  if (extraction?.metadata === "failed") {
    out.push(
      annotate(
        {
          id: "pdf-metadata-extraction-failed",
          lens: "a11y",
          severity: "info",
          title: message("rules.pdf-metadata-extraction-failed.title"),
          detail: message("rules.pdf-metadata-extraction-failed.detail"),
        },
        "pdf-object-model",
      ),
    );
  } else if (!meta.lang || !meta.title) {
    const titleKey = !meta.lang && !meta.title
      ? "rules.pdf-lang-title.titleBoth"
      : meta.lang
        ? "rules.pdf-lang-title.titleTitle"
        : "rules.pdf-lang-title.titleLang";
    const standards: StandardRef[] = [
      ...(!meta.title ? standardsFor("no-title") : []),
      ...(!meta.lang ? standardsFor("no-lang") : []),
    ];
    out.push(
      annotate(
        {
          id: "pdf-lang-title",
          lens: "a11y",
          severity: "warning",
          title: message(titleKey),
          detail: message("rules.pdf-lang-title.detail"),
          standards,
        },
        "pdf-object-model",
      ),
    );
  }
  if (extraction?.markInfo === "failed" && meta.tagged !== true) {
    out.push(
      annotate(
        {
          id: "pdf-mark-info-extraction-failed",
          lens: "a11y",
          severity: "info",
          title: message("rules.pdf-mark-info-extraction-failed.title"),
          detail: message("rules.pdf-mark-info-extraction-failed.detail"),
        },
        "pdf-object-model",
      ),
    );
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
