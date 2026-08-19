import { CHECK_IDS, type CheckId, type CheckScores, type Finding, type Severity } from "./types";

export const POINTS: Record<Severity, number> = {
  error: 15,
  warning: 6,
  info: 2,
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function findingAppliesTo(finding: Finding, check: CheckId): boolean {
  if (finding.lens === "both") return check === "ats" || check === "a11y";
  return finding.lens === check;
}

export function computeScores(findings: Finding[]): CheckScores {
  const scores = Object.fromEntries(CHECK_IDS.map((id) => [id, 100])) as CheckScores;
  for (const f of findings) {
    const cost = POINTS[f.severity];
    for (const check of CHECK_IDS) {
      if (findingAppliesTo(f, check)) scores[check] -= cost;
    }
  }
  for (const check of CHECK_IDS) scores[check] = clamp(scores[check]);
  return scores;
}
