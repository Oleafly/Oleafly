import type { CheckCoverage, Coverage, Finding, PdfExtractionStatus, PdfFacts, PositionedText, PreflightEngine, PreflightReport, ProjectContext } from "./types";
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
import type * as Writing from "./writing";
import type { WritingSettings } from "./writing/settings";

export type SourcePreflightProfile = "latex" | "typst" | "none";

export interface SourceRuleInput {
  readonly source: string;
  readonly project?: ProjectContext;
  readonly submissionProfile: SubmissionProfileId;
  readonly anonymousReview: boolean;
  readonly pdf?: PdfFacts;
  readonly engine: PreflightEngine;
  readonly typstVersion?: string;
  readonly writing?: WritingCheck;
}

export type WritingRules = Pick<typeof Writing, "runWritingRules" | "runProjectWritingRules" | "writingContextFor" | "isReviewsFile">;

export interface WritingCheck {
  readonly settings: WritingSettings;
  readonly rules: WritingRules;
}

export interface SourceRuleSet {
  readonly source: (input: SourceRuleInput) => Finding[];
  readonly refs: (input: SourceRuleInput, refs: RefsContext) => Finding[];
  readonly submission: (input: SourceRuleInput, project: ProjectContext) => Finding[];
}

export interface PreflightInput {
  source: string;
  sourceProfile?: SourcePreflightProfile;
  sourceRules?: SourceRuleSet;
  typstVersion?: string;
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
  writing?: WritingCheck;
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

function submissionCoverage(supported: boolean, hasProject: boolean, hasFacts: boolean): Coverage {
  if (!supported) return "unsupported";
  if (!hasProject) return "not_run";
  return hasFacts ? "evaluated" : "partial";
}

function privacyCoverage(supported: boolean, hasProject: boolean, factsPending: boolean): Coverage {
  if (!supported) return "unsupported";
  if (!hasProject) return "not_run";
  return factsPending ? "partial" : "evaluated";
}

function writingCoverage(hasWriting: boolean, sourceProfile: SourcePreflightProfile): Coverage {
  if (!hasWriting) return "not_run";
  return sourceProfile === "latex" ? "evaluated" : "unsupported";
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
      ...(file.path && finding.from !== undefined && finding.file === undefined ? { file: file.path } : {}),
    })),
  );
}

const WRITING_SOURCE = /\.(?:tex|ltx)$/i;

function latexWritingFindings(sources: readonly LatexSource[], input: SourceRuleInput): PreflightReport["findings"] {
  if (!input.writing) return [];
  const { settings, rules } = input.writing;
  const context = rules.writingContextFor(sources.map((file) => file.content), settings);
  const documents = sources.filter((file) => file.path === undefined || WRITING_SOURCE.test(file.path));
  const perFile = documents.flatMap((file) =>
    rules.runWritingRules(file.content, { settings, ...context }).map((finding) => ({
      ...finding,
      ...(file.path ? { file: file.path } : {}),
    })),
  );
  const reviews = (input.project?.files ?? []).flatMap((file) =>
    file.content !== undefined && rules.isReviewsFile(file.path) ? [{ path: file.path, content: file.content }] : [],
  );
  const project = rules.runProjectWritingRules(
    [
      ...documents.map((file) => ({ path: file.path ?? input.project?.mainFile ?? "main.tex", content: file.content })),
      ...reviews,
    ],
    { settings, ...context, mainFile: input.project?.mainFile ?? documents[0]?.path ?? "main.tex" },
  );
  return [...perFile, ...project];
}

const LATEX_SOURCE_RULES: SourceRuleSet = {
  source: (input) => {
    const sources = latexProjectSources(input.project, input.source);
    return [
      ...sources.flatMap((file) =>
        runSourceRules(file.content, { engine: input.engine }).map((finding) => ({
          ...finding,
          ...(file.path ? { file: file.path } : {}),
        })),
      ),
      ...latexWritingFindings(sources, input),
    ];
  },
  refs: (input, refs) => projectRefsFindings(latexProjectSources(input.project, input.source), refs),
  submission: (input, project) =>
    runSubmissionRules({
      project,
      profileId: input.submissionProfile,
      pdf: input.pdf,
      anonymousReview: input.anonymousReview,
    }),
};

function sourceRulesFor(profile: SourcePreflightProfile, typstRules: SourceRuleSet | undefined): SourceRuleSet | null {
  if (profile === "latex") return LATEX_SOURCE_RULES;
  if (profile === "typst") return typstRules ?? null;
  return null;
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
  sourceRules,
  typstVersion,
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
  writing,
}: PreflightInput): PreflightReport {
  const rules = sourceRulesFor(sourceProfile, sourceRules);
  const supported = rules !== null;
  const atsParse = readerText !== undefined ? simulateAtsParse(readerText) : undefined;
  const ruleInput: SourceRuleInput = {
    source,
    submissionProfile,
    anonymousReview,
    engine,
    ...(project ? { project } : {}),
    ...(facts ? { pdf: facts } : {}),
    ...(typstVersion ? { typstVersion } : {}),
    ...(writing ? { writing } : {}),
  };
  const sourceFindings = rules ? rules.source(ruleInput) : [];
  const refsFindings = rules && refs ? rules.refs(ruleInput, refs) : [];

  const findings = dedupeUntaggedFinding([
    ...sourceFindings,
    ...(pages ? runPdfRules(pages, meta, extraction, facts, submissionProfile) : []),
    ...structureOnlyFindings(struct, extraction, meta),
    ...(atsParse ? atsParseFindings(atsParse, facts) : []),
    ...refsFindings,
    ...runCompileRules(compile, facts),
    ...(rules && project ? rules.submission(ruleInput, project) : []),
  ]);

  const scores = computeScores(findings);
  const compileRan = compile?.status === "success" || compile?.status === "error" || Boolean(facts);
  const coverage: CheckCoverage = {
    ats: pages && readerText !== undefined ? "evaluated" : "not_run",
    compile: compileRan ? "evaluated" : "not_run",
    a11y: pages ? "evaluated" : "not_run",
    refs: supported && refs ? "evaluated" : "unsupported",
    submission: submissionCoverage(supported, Boolean(project), Boolean(facts)),
    privacy: privacyCoverage(supported, Boolean(project), anonymousReview && !facts),
    writing: writingCoverage(Boolean(writing), sourceProfile),
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
    writingScore: scoreOrNull("writing"),
    coverage,
    ranAt: Date.now(),
    hasPdf: pages !== undefined,
    atsParse,
    ...(pages !== undefined
      ? { pdfUa: pdfUaCoverage(findings, pdfUaAvailability(extraction, struct, meta)) }
      : {}),
  };
}
