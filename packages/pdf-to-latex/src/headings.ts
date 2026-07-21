import type { Para } from "./lines";
import { mode } from "./lines";

export function bodyFontSize(paras: Para[]): number {
  return mode(paras.map((p) => p.fontSize));
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
