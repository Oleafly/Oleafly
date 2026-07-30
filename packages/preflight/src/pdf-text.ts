import type { PositionedText } from "./types";

interface PdfTextItemLike {
  str: string;
  transform: readonly unknown[];
  width: number;
  height?: number;
  hasEOL?: boolean;
}

export interface ReconstructedPdfPage {
  items: PositionedText[];
  text: string;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isPdfTextItem(value: unknown): value is PdfTextItemLike {
  if (!value || typeof value !== "object" || !("str" in value)) return false;
  const candidate = value as Partial<PdfTextItemLike>;
  return (
    typeof candidate.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number"
  );
}

function needsGeometrySpace(
  previous: PositionedText,
  previousHeight: number,
  current: PositionedText,
  currentHeight: number,
): boolean {
  if (!previous.str || !current.str || /\s$/u.test(previous.str) || /^\s/u.test(current.str)) {
    return false;
  }
  const gap = current.x - (previous.x + previous.width);
  if (gap <= 0) return false;
  const availableHeights = [previousHeight, currentHeight].filter(
    (height) => height > 0,
  );
  const referenceHeight = availableHeights.length
    ? Math.min(...availableHeights)
    : 10;
  // Text runs from the same word commonly have a sub-point rounding gap.
  // A gap of at least 12% of the font height is a visible word boundary.
  return gap >= Math.max(0.75, referenceHeight * 0.12);
}

function removeHorizontalSpaceBeforeLineBreaks(source: string): string {
  const output: string[] = [];
  for (const character of source) {
    if (character === "\n") {
      while (output.at(-1) === " " || output.at(-1) === "\t") {
        output.pop();
      }
    }
    output.push(character);
  }
  return output.join("");
}

/**
 * Reconstruct reader text in the content-stream order supplied by PDF.js.
 * Geometry is used only to add missing separators, never to sort runs, because
 * sorting would hide the very reading-order defects Preflight is meant to find.
 */
export function reconstructPdfPageText(values: readonly unknown[]): ReconstructedPdfPage {
  const items: PositionedText[] = [];
  const chunks: string[] = [];
  let previous: PositionedText | null = null;
  let previousHeight = 0;
  let previousHadEol = false;

  for (const value of values) {
    if (!isPdfTextItem(value)) continue;
    const x = finiteNumber(value.transform[4]);
    const y = finiteNumber(value.transform[5]);
    const width = Math.max(0, finiteNumber(value.width));
    const height = Math.max(
      0,
      finiteNumber(value.height, Math.hypot(
        finiteNumber(value.transform[2]),
        finiteNumber(value.transform[3]),
      )),
    );
    const item = { str: value.str, x, y, width };
    items.push(item);

    const geometryLineBreak =
      previous !== null &&
      Math.abs(y - previous.y) > Math.max(2, Math.min(previousHeight || 10, height || 10) * 0.35);
    if (chunks.length > 0 && (previousHadEol || geometryLineBreak)) {
      if (!chunks.at(-1)?.endsWith("\n")) chunks.push("\n");
    } else if (
      previous !== null &&
      needsGeometrySpace(previous, previousHeight, item, height)
    ) {
      chunks.push(" ");
    }

    chunks.push(value.str);
    if (value.hasEOL) chunks.push("\n");
    previous = item;
    previousHeight = height;
    previousHadEol = value.hasEOL === true;
  }

  return {
    items,
    text: removeHorizontalSpaceBeforeLineBreaks(chunks.join("")).trim(),
  };
}
