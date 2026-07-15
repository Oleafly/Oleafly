import type { PositionedText, PreflightReport } from "./types";
import type { StructDoc } from "./structure";
import { runSourceRules } from "./source-rules";
import { runPdfRules } from "./pdf-rules";
import { verifyStructure } from "./structure";
import { simulateAtsParse, atsParseFindings } from "./ats-parse";
import { runRefsRules, type RefsContext } from "./refs-rules";
import { computeScores } from "./score";

export interface PreflightInput {
  source: string;
  sourceProfile?: "latex" | "none";
  pages?: PositionedText[][];
  meta?: { lang?: string | null; title?: string | null; tagged?: boolean };
  readerText?: string;
  struct?: StructDoc;
  refs?: RefsContext;
}

export function runPreflight({ source, sourceProfile = "latex", pages, meta, readerText, struct, refs }: PreflightInput): PreflightReport {
  const atsParse = readerText !== undefined ? simulateAtsParse(readerText) : undefined;

  const findings = [
    ...(sourceProfile === "latex" ? runSourceRules(source) : []),
    ...(pages ? runPdfRules(pages, meta) : []),
    ...(struct ? verifyStructure(struct) : []),
    ...(atsParse ? atsParseFindings(atsParse) : []),
    ...(sourceProfile === "latex" && refs ? runRefsRules(source, refs) : []),
  ];

  const { ats, a11y, refs: refsScore } = computeScores(findings);
  const coverage = {
    ats: pages && readerText !== undefined ? "evaluated" as const : "not_run" as const,
    a11y: pages ? "evaluated" as const : "not_run" as const,
    refs: sourceProfile === "latex" && refs ? "evaluated" as const : "unsupported" as const,
  };
  return {
    findings,
    atsScore: coverage.ats === "evaluated" ? ats : null,
    a11yScore: coverage.a11y === "evaluated" ? a11y : null,
    refsScore: coverage.refs === "evaluated" ? refsScore : null,
    coverage,
    ranAt: Date.now(),
    hasPdf: pages !== undefined,
    atsParse,
  };
}
