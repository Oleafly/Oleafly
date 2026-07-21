import type { Para } from "./lines";

export function bodyFontSize(paras: Para[]): number {
  // weight by text length: body text dominates by characters, not by count
  const weights = new Map<number, number>();
  for (const p of paras) {
    const k = Math.round(p.fontSize * 2) / 2;
    weights.set(k, (weights.get(k) ?? 0) + p.text.length);
  }
  let best = paras[0]?.fontSize ?? 0;
  let bestWeight = 0;
  for (const [k, w] of weights) {
    if (w > bestWeight) {
      best = k;
      bestWeight = w;
    }
  }
  return best;
}

export function classifyHeadings(paras: Para[], sensitivity = 0.5): Map<Para, 1 | 2 | 3> {
  const body = bodyFontSize(paras);
  const threshold = body + (1.5 - sensitivity);
  const sizes = [
    ...new Set(
      paras.filter((p) => p.fontSize >= threshold && headingish(p)).map((p) => p.fontSize),
    ),
  ].sort((a, b) => b - a);
  const levelOf = new Map(sizes.slice(0, 3).map((s, i) => [s, (i + 1) as 1 | 2 | 3]));
  const out = new Map<Para, 1 | 2 | 3>();
  for (const p of paras) {
    const lvl = levelOf.get(p.fontSize);
    if (lvl && headingish(p)) out.set(p, lvl);
  }
  return out;
}

function headingish(p: Para): boolean {
  return p.lines.length <= 2 && p.text.length <= 120 && !/[.:;]$/.test(p.text.trim());
}
