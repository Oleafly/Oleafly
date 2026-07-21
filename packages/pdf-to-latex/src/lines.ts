import type { TextItem } from "./types";

export interface Line {
  items: TextItem[];
  y: number;
  text: string;
  fontSize: number;
  x0: number;
  x1: number;
}

export interface Para {
  lines: Line[];
  text: string;
  fontSize: number;
}

export function buildLines(items: TextItem[]): Line[] {
  const sorted = [...items]
    .filter((i) => i.str.trim().length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    // floor of 4 keeps sub/superscripts attached to their baseline line
    const tol = Math.max(4, item.fontSize * 0.4);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tol);
    if (line) line.items.push(item);
    else
      lines.push({
        items: [item],
        y: item.y,
        text: "",
        fontSize: item.fontSize,
        x0: item.x,
        x1: item.x + item.width,
      });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    l.fontSize = mode(l.items.map((i) => i.fontSize));
    // baseline from dominant-font items so scripts don't skew it
    const baseYs = l.items
      .filter((i) => Math.abs(i.fontSize - l.fontSize) < 0.5)
      .map((i) => i.y)
      .sort((a, b) => a - b);
    if (baseYs.length > 0) l.y = baseYs[Math.floor(baseYs.length / 2)];
    l.x0 = Math.min(...l.items.map((i) => i.x));
    l.x1 = Math.max(...l.items.map((i) => i.x + i.width));
  }
  return lines;
}

export function buildParas(lines: Line[]): Para[] {
  const paras: Para[] = [];
  for (const line of lines) {
    const prev = paras[paras.length - 1];
    const last = prev?.lines[prev.lines.length - 1];
    const gapOk = last ? last.y - line.y <= line.fontSize * 1.8 : false;
    const sizeOk = last ? Math.abs(last.fontSize - line.fontSize) < 0.5 : false;
    if (prev && gapOk && sizeOk) prev.lines.push(line);
    else paras.push({ lines: [line], text: "", fontSize: line.fontSize });
  }
  for (const p of paras) {
    p.text = p.lines
      .map((l) => l.text)
      .reduce((acc, t) => {
        if (/[a-z]-$/.test(acc)) {
          if (/^[a-z]/.test(t)) return acc.slice(0, -1) + t;
          return acc + t;
        }
        return acc ? `${acc} ${t}` : t;
      }, "");
    p.fontSize = mode(p.lines.map((l) => l.fontSize));
  }
  return paras;
}

export function mode(nums: number[]): number {
  const counts = new Map<number, number>();
  for (const n of nums) {
    const k = Math.round(n * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = nums[0] ?? 0;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}
