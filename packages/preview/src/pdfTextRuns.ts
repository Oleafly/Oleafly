import type { PdfTextRun } from "./pdfController";

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL?: boolean;
}

interface TextContentLike {
  items: readonly (TextItemLike | { type: string })[];
  styles: Record<string, { ascent?: number } | undefined>;
}

interface ViewportLike {
  convertToViewportPoint(x: number, y: number): number[];
}

/** pdf.js puts a run's top at its baseline minus this share of the font size when a font gives no ascent. */
const DEFAULT_ASCENT = 0.8;

/**
 * A page's text items as runs in the frame SyncTeX uses: points from the
 * top-left of the page as TeX laid it out. `unrotated` is the page's scale-1
 * viewport with rotation 0.
 */
export function pdfTextRuns(content: TextContentLike, unrotated: ViewportLike): PdfTextRun[] {
  return content.items.flatMap((item) => {
    if (!("str" in item)) return [];
    const [, , c, d, e, f] = item.transform;
    const height = Math.hypot(c, d);
    const ascent = content.styles[item.fontName]?.ascent || DEFAULT_ASCENT;
    const [x, baseline] = unrotated.convertToViewportPoint(e, f);
    return [{ str: item.str, x, top: baseline - height * ascent, width: item.width, height, hasEOL: item.hasEOL }];
  });
}
