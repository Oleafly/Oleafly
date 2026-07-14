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
  pages?: PositionedText[][];
  meta?: { lang?: string | null; title?: string | null; tagged?: boolean };
  readerText?: string;
  struct?: StructDoc;
  refs?: RefsContext;
}

export function runPreflight({ source, pages, meta, readerText, struct, refs }: PreflightInput): PreflightReport {
  const atsParse = readerText !== undefined ? simulateAtsParse(readerText) : undefined;

  const findings = [
    ...runSourceRules(source),
    ...(pages ? runPdfRules(pages, meta) : []),
    ...(struct ? verifyStructure(struct) : []),
    ...(atsParse ? atsParseFindings(atsParse) : []),
    ...(refs ? runRefsRules(source, refs) : []),
  ];

  const { ats, a11y, refs: refsScore } = computeScores(findings);
  return {
    findings,
    atsScore: ats,
    a11yScore: a11y,
    refsScore,
    ranAt: Date.now(),
    hasPdf: pages !== undefined,
    atsParse,
  };
}
