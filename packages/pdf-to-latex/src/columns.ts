import type { TextItem } from "./types";

export function detectColumns(
  items: TextItem[],
  pageWidth: number,
): { count: 1 | 2; splitX: number | null } {
  if (items.length < 4) return { count: 1, splitX: null };
  const starts = items.map((i) => i.x).sort((a, b) => a - b);
  let bestGap = 0;
  let splitX = 0;
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    const mid = (starts[i] + starts[i - 1]) / 2;
    if (gap > bestGap && mid > pageWidth * 0.25 && mid < pageWidth * 0.75) {
      bestGap = gap;
      splitX = mid;
    }
  }
  if (bestGap < pageWidth * 0.08) return { count: 1, splitX: null };
  const left = items.filter((i) => i.x < splitX).length;
  const right = items.length - left;
  const crossing = items.filter(
    (i) => i.x < splitX && i.x + i.width > splitX + pageWidth * 0.05,
  ).length;
  if (left < 2 || right < 2 || crossing / items.length > 0.1) {
    return { count: 1, splitX: null };
  }
  return { count: 2, splitX };
}

export function orderByColumns(
  items: TextItem[],
  pageWidth: number,
  forced: "auto" | 1 | 2 = "auto",
): TextItem[] {
  const d =
    forced === "auto"
      ? detectColumns(items, pageWidth)
      : { count: forced, splitX: forced === 2 ? pageWidth / 2 : null };
  if (d.count === 1 || d.splitX == null) return items;
  const split = d.splitX;
  const left = items.filter((i) => i.x < split);
  const right = items.filter((i) => i.x >= split);
  return [...left, ...right];
}
