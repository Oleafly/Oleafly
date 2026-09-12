import type { CheckCoverage, Coverage, PdfExtractionStatus, PdfFacts, PositionedText, PreflightEngine, PreflightReport, ProjectContext } from "./types";
import type { StructDoc } from "./structure";
import { runSourceRules } from "./source-rules";
import { runPdfRules } from "./pdf-rules";
import { verifyStructure } from "./structure";
import { simulateAtsParse, atsParseFindings } from "./ats-parse";
import { runRefsRules, type RefsContext } from "./refs-rules";
import { computeScores } from "./score";
import { runCompileRules, type CompileContext } from "./compile-rules";
import { runSubmissionRules } from "./submission-rules";
import { pdfUaCoverage, type PdfUaAvailability } from "./standards";
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
  engine?: PreflightEngine;
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

export function pdfUaAvailability(
  extraction: PdfExtractionStatus | undefined,
  struct: StructDoc | undefined,
  meta: PreflightInput["meta"],
): PdfUaAvailability {
  const ua = struct?.ua;
  const readTheMetadata = extraction?.metadata === "ok";
  const structureRead = (extraction?.structure ?? "ok") === "ok";
  const tagged = struct?.tagged ?? meta?.tagged ?? null;
  const hasRoot = (struct?.root ?? null) !== null;
  const reachedTheTagTree = hasRoot || structureRead;
  const walkedTheTagTree = tagged === true && structureRead && hasRoot;
  const readTheCatalogFacts = ua !== undefined && tagged === true && reachedTheTagTree;
  const checkedTheClaim = ua !== undefined && tagged !== null && (tagged === false || reachedTheTagTree);
  return {
    metadata: readTheMetadata,
    markInfo: extraction?.markInfo === "ok" && readTheCatalogFacts,
    structure: walkedTheTagTree,
    viewerPreferences: readTheCatalogFacts && ua !== undefined && ua.displayDocTitle !== null,
    annotations: readTheCatalogFacts,
    markedContent: readTheCatalogFacts && walkedTheTagTree,
    identifiesAsPdfUa1: readTheMetadata && checkedTheClaim && ua?.uaPart === 1,
    tagged,
  };
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

type LatexSource = { path: string | undefined; content: string };

function submissionCoverage(isLatex: boolean, hasProject: boolean, hasFacts: boolean): Coverage {
  if (!isLatex) return "unsupported";
  if (!hasProject) return "not_run";
  return hasFacts ? "evaluated" : "partial";
}

function privacyCoverage(isLatex: boolean, hasProject: boolean, factsPending: boolean): Coverage {
  if (!isLatex) return "unsupported";
  if (!hasProject) return "not_run";
  return factsPending ? "partial" : "evaluated";
}

function projectRefsFindings(
  latexSources: readonly LatexSource[],
  refs: RefsContext,
): PreflightReport["findings"] {
  return latexSources.flatMap((file, index) =>
    runRefsRules(file.content, refs, {
      includeProjectQuality: index === 0,
      ...(file.path ? { file: file.path } : {}),
    }).map((finding) => ({
      ...finding,
      ...(file.path && finding.from !== undefined ? { file: file.path } : {}),
    })),
  );
}

function structureOnlyFindings(
  struct: StructDoc | undefined,
  extraction: PdfExtractionStatus | undefined,
  meta: PreflightInput["meta"],
): PreflightReport["findings"] {
  if (struct) return verifyStructure(struct, extraction?.structureFailedPages);
  if (meta?.tagged === false) return verifyStructure({ root: null, tagged: false });
  return [];
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
  engine = "unknown",
}: PreflightInput): PreflightReport {
  const isLatex = sourceProfile === "latex";
  const atsParse = readerText !== undefined ? simulateAtsParse(readerText) : undefined;
  const latexSources = isLatex ? latexProjectSources(project, source) : [];
  const sourceFindings = latexSources.flatMap((file) =>
    runSourceRules(file.content, { engine }).map((finding) => ({ ...finding, ...(file.path ? { file: file.path } : {}) })),
  );
  const refsFindings = isLatex && refs ? projectRefsFindings(latexSources, refs) : [];

  const findings = dedupeUntaggedFinding([
    ...sourceFindings,
    ...(pages ? runPdfRules(pages, meta, extraction, facts, submissionProfile) : []),
    ...structureOnlyFindings(struct, extraction, meta),
    ...(atsParse ? atsParseFindings(atsParse, facts) : []),
    ...refsFindings,
    ...runCompileRules(compile, facts),
    ...(isLatex && project
      ? runSubmissionRules({ project, profileId: submissionProfile, pdf: facts, anonymousReview })
      : []),
  ]);

  const scores = computeScores(findings);
  const compileRan = compile?.status === "success" || compile?.status === "error" || Boolean(facts);
  const coverage: CheckCoverage = {
    ats: pages && readerText !== undefined ? "evaluated" : "not_run",
    compile: compileRan ? "evaluated" : "not_run",
    a11y: pages ? "evaluated" : "not_run",
    refs: isLatex && refs ? "evaluated" : "unsupported",
    submission: submissionCoverage(isLatex, Boolean(project), Boolean(facts)),
    privacy: privacyCoverage(isLatex, Boolean(project), anonymousReview && !facts),
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
    ...(pages !== undefined
      ? { pdfUa: pdfUaCoverage(findings, pdfUaAvailability(extraction, struct, meta)) }
      : {}),
  };
}
