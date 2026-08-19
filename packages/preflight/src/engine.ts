import type { PdfExtractionStatus, PdfFacts, PositionedText, PreflightReport, ProjectContext } from "./types";
import type { StructDoc } from "./structure";
import { runSourceRules } from "./source-rules";
import { runPdfRules } from "./pdf-rules";
import { verifyStructure } from "./structure";
import { simulateAtsParse, atsParseFindings } from "./ats-parse";
import { runRefsRules, type RefsContext } from "./refs-rules";
import { computeScores } from "./score";
import { runCompileRules, type CompileContext } from "./compile-rules";
import { runSubmissionRules } from "./submission-rules";
import type { SubmissionProfileId } from "./profiles";

export interface PreflightInput {
  source: string;
  sourceProfile?: "latex" | "none";
  pages?: PositionedText[][];
  meta?: { lang?: string | null; title?: string | null; tagged?: boolean | null };
  extraction?: PdfExtractionStatus;
  readerText?: string;
  struct?: StructDoc;
  refs?: RefsContext;
  facts?: PdfFacts;
  project?: ProjectContext;
  compile?: CompileContext;
  submissionProfile?: SubmissionProfileId;
  anonymousReview?: boolean;
}

function dedupeUntaggedFinding(findings: PreflightReport["findings"]) {
  let sawUntagged = false;
  return findings.filter((finding) => {
    if (finding.id !== "pdf-untagged-output") return true;
    if (sawUntagged) return false;
    sawUntagged = true;
    return true;
  });
}

function latexProjectSources(project: ProjectContext | undefined, fallback: string) {
  if (!project) return [{ path: undefined, content: fallback }];
  const files = project.files
    .filter((file) => file.content !== undefined && /\.(?:tex|ltx|sty|cls)$/i.test(file.path))
    .sort((left, right) => Number(right.path === project.mainFile) - Number(left.path === project.mainFile));
  return files.length > 0
    ? files.map((file) => ({ path: file.path, content: file.content ?? "" }))
    : [{ path: project.mainFile, content: fallback }];
}

export function runPreflight({
  source,
  sourceProfile = "latex",
  pages,
  meta,
  extraction,
  readerText,
  struct,
  refs,
  facts,
  project,
  compile,
  submissionProfile = "generic",
  anonymousReview = false,
}: PreflightInput): PreflightReport {
  const atsParse = readerText !== undefined ? simulateAtsParse(readerText) : undefined;
  const latexSources = sourceProfile === "latex" ? latexProjectSources(project, source) : [];
  const sourceFindings = latexSources.flatMap((file) =>
    runSourceRules(file.content).map((finding) => ({ ...finding, ...(file.path ? { file: file.path } : {}) })),
  );
  const refsFindings =
    sourceProfile === "latex" && refs
      ? latexSources.flatMap((file, index) =>
          runRefsRules(file.content, refs, { includeProjectQuality: index === 0 }).map((finding) => ({
            ...finding,
            ...(file.path && finding.from !== undefined ? { file: file.path } : {}),
          })),
        )
      : [];

  const findings = dedupeUntaggedFinding([
    ...sourceFindings,
    ...(pages ? runPdfRules(pages, meta, extraction, facts, submissionProfile) : []),
    ...(struct
      ? verifyStructure(struct, extraction?.structureFailedPages)
      : meta?.tagged === false
        ? verifyStructure({ root: null, tagged: false })
        : []),
    ...(atsParse ? atsParseFindings(atsParse, facts) : []),
    ...refsFindings,
    ...runCompileRules(compile, facts),
    ...(sourceProfile === "latex" && project
      ? runSubmissionRules({ project, profileId: submissionProfile, pdf: facts, anonymousReview })
      : []),
  ]);

  const scores = computeScores(findings);
  const coverage = {
    ats: pages && readerText !== undefined ? "evaluated" as const : "not_run" as const,
    compile: compile?.status === "success" || compile?.status === "error" || facts ? "evaluated" as const : "not_run" as const,
    a11y: pages ? "evaluated" as const : "not_run" as const,
    refs: sourceProfile === "latex" && refs ? "evaluated" as const : "unsupported" as const,
    submission:
      sourceProfile !== "latex"
        ? "unsupported" as const
        : project
          ? facts
            ? "evaluated" as const
            : "partial" as const
          : "not_run" as const,
    privacy:
      sourceProfile !== "latex"
        ? "unsupported" as const
        : project
          ? anonymousReview && !facts
            ? "partial" as const
            : "evaluated" as const
          : "not_run" as const,
  };
  const scoreOrNull = (id: keyof typeof coverage) =>
    coverage[id] === "not_run" || coverage[id] === "unsupported" ? null : scores[id];
  return {
    findings,
    scores,
    atsScore: scoreOrNull("ats"),
    compileScore: scoreOrNull("compile"),
    a11yScore: scoreOrNull("a11y"),
    refsScore: scoreOrNull("refs"),
    submissionScore: scoreOrNull("submission"),
    privacyScore: scoreOrNull("privacy"),
    coverage,
    ranAt: Date.now(),
    hasPdf: pages !== undefined,
    atsParse,
  };
}
