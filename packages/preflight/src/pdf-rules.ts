import type { Finding, PositionedText } from "./types";

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

export function catalogFindings(meta: { lang?: string | null; title?: string | null; tagged?: boolean }): Finding[] {
  const out: Finding[] = [];
  if (!meta.lang || !meta.title) {
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
  if (meta.tagged === false) {
    out.push({
      id: "pdf-tagged",
      lens: "a11y",
      severity: "info",
      title: "PDF is not tagged",
      detail:
        "This PDF has no accessibility tags, which a formal PDF/UA or Section 508 check requires. The current compile engine does not produce tags. This is a roadmap item, not a fix you can make in the source today.",
    });
  }
  return out;
}

export function runPdfRules(
  pages: PositionedText[][],
  meta?: { lang?: string | null; title?: string | null; tagged?: boolean },
): Finding[] {
  const text = pages.map((p) => p.map((it) => it.str).join("")).join("\n");
  return [
    ...analyzeReadingOrder(pages),
    ...detectGarbledText(text),
    ...checkSelectability(pages),
    ...(meta ? catalogFindings(meta) : []),
  ];
}
