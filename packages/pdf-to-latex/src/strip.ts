import type { Line } from "./lines";

export function stripRepeatedFurniture(pages: Line[][], pageHeights: number[]): Line[][] {
  if (pages.length < 3) return pages;
  const inBand = (l: Line, h: number) => l.y > h * 0.92 || l.y < h * 0.08;
  const norm = (t: string) => t.replace(/\d+/g, "#").trim().toLowerCase();
  const counts = new Map<string, number>();
  pages.forEach((p, pi) => {
    for (const l of p) {
      if (inBand(l, pageHeights[pi])) {
        counts.set(norm(l.text), (counts.get(norm(l.text)) ?? 0) + 1);
      }
    }
  });
  const repeated = new Set(
    [...counts].filter(([, c]) => c >= pages.length * 0.6).map(([k]) => k),
  );
  return pages.map((p, pi) =>
    p.filter((l) => {
      if (!inBand(l, pageHeights[pi])) return true;
      if (/^\d+$/.test(l.text.trim())) return false;
      return !repeated.has(norm(l.text));
    }),
  );
}
