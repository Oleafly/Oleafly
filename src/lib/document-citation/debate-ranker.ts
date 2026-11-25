import type { LiteratureRecord } from "@/lib/literature-search";

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function heuristicScore(
  record: LiteratureRecord,
  rankIndex: number,
  groupSize: number,
  maxCitations: number,
): number {
  const n = groupSize || 1;
  const pos = 1 - rankIndex / n;
  const cites = record.citationCount ?? 0;
  const denom = Math.log10(Math.max(maxCitations, 0) + 1);
  const citNorm =
    denom > 0 ? Math.log10(Math.max(cites, 0) + 1) / denom : 0;
  return clampScore(0.7 * pos * 100 + 0.3 * citNorm * 100);
}