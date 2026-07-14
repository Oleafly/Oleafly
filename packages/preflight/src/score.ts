import type { Finding, Severity } from "./types";

export const POINTS: Record<Severity, number> = {
  error: 15,
  warning: 6,
  info: 2,
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeScores(findings: Finding[]): { ats: number; a11y: number; refs: number } {
  let ats = 100;
  let a11y = 100;
  let refs = 100;
  for (const f of findings) {
    const cost = POINTS[f.severity];
    if (f.lens === "ats" || f.lens === "both") ats -= cost;
    if (f.lens === "a11y" || f.lens === "both") a11y -= cost;
    if (f.lens === "refs") refs -= cost;
  }
  return { ats: clamp(ats), a11y: clamp(a11y), refs: clamp(refs) };
}
