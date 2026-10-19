import path from "node:path";
import { describe, it } from "vitest";
import {
  type BibliographyEngine,
  bibliographyCandidatePaths,
  bibliographyDeclarations,
  bibliographyDisplayName,
  resolveBibliographyPath,
} from "@oleafly/latex";
import {
  type CompileContext,
  containsContactToken,
  detectSubmissionProfile,
  extractDocumentClass,
  extractEmail,
  extractPhoneNumber,
  extractTypstTemplates,
  looksLikeResumeSource,
  maskComments,
  matchResumeSectionHeading,
  type PdfFacts,
  type PreflightEngine,
  type PreflightInput,
  type ProjectContext,
  type RefsContext,
  requestsTaggedPdf,
  runCompileRules,
  runPreflight,
  runRefsRules,
  runSourceRules,
  runSubmissionRules,
  type SubmissionProfileId,
} from "@oleafly/preflight";
import {
  runTypstRefsRules,
  runTypstSourceRules,
  runTypstSubmissionRules,
  TYPST_SOURCE_RULES,
  typstMetadataFindings,
} from "@oleafly/preflight/typst";
import { parseEntry } from "@/lib/citation/bibtex";
import { hayagrivaKeys, looksLikeHayagriva } from "@/lib/citation/hayagriva";
import { resolveTypstPath, typstVersionAtLeast } from "../../../../packages/preflight/src/typst-scan";
import { expectGolden, normalizeFindings, PREFLIGHT_FIXTURES, readCases } from "./support";

type Case = { name: string } & Record<string, unknown>;

const cases = (suite: string) => readCases<Case>(path.join(PREFLIGHT_FIXTURES, "cases", `${suite}.json`));
const expected = (suite: string) => path.join(PREFLIGHT_FIXTURES, "expected", `${suite}.json`);

function golden(suite: string, run: (testCase: Case) => unknown): void {
  const out: Record<string, unknown> = {};
  for (const testCase of cases(suite)) out[testCase.name] = run(testCase);
  expectGolden(expected(suite), out);
}

const submissionInput = (testCase: Case) => ({
  project: testCase.project as ProjectContext,
  profileId: testCase.profileId as SubmissionProfileId,
  ...(testCase.pdf ? { pdf: testCase.pdf as PdfFacts } : {}),
  ...(testCase.anonymousReview !== undefined ? { anonymousReview: testCase.anonymousReview as boolean } : {}),
});

function optional<T>(value: unknown): T | undefined {
  return value === null ? undefined : (value as T);
}

function helper(testCase: Case): unknown {
  const args = testCase.args as unknown[];
  const text = (index: number) => args[index] as string;
  switch (testCase.fn) {
    case "extractPhoneNumber":
      return extractPhoneNumber(text(0));
    case "containsContactToken":
      return containsContactToken(text(0));
    case "extractEmail":
      return extractEmail(text(0));
    case "matchResumeSectionHeading":
      return matchResumeSectionHeading(text(0));
    case "looksLikeResumeSource":
      return looksLikeResumeSource(text(0));
    case "detectSubmissionProfile":
      return detectSubmissionProfile(text(0));
    case "extractDocumentClass":
      return extractDocumentClass(text(0));
    case "extractTypstTemplates":
      return extractTypstTemplates(text(0));
    case "maskComments":
      return maskComments(text(0));
    case "requestsTaggedPdf":
      return requestsTaggedPdf(text(0));
    case "bibliographyDeclarations":
      return bibliographyDeclarations(text(0));
    case "bibliographyCandidatePaths":
      return bibliographyCandidatePaths(text(0), text(1), args[2] as BibliographyEngine);
    case "resolveBibliographyPath":
      return resolveBibliographyPath(text(0), text(1), args[2] as string[], args[3] as BibliographyEngine);
    case "bibliographyDisplayName":
      return bibliographyDisplayName(text(0), args[1] as BibliographyEngine);
    case "parseEntry":
      return parseEntry(text(0));
    case "hayagrivaKeys":
      return [...hayagrivaKeys(text(0))].sort();
    case "looksLikeHayagriva":
      return looksLikeHayagriva(text(0));
    case "typstVersionAtLeast":
      return typstVersionAtLeast(optional<string>(args[0]), args[1] as number[]);
    case "resolveTypstPath":
      return resolveTypstPath(optional<string>(args[0]), text(1));
    default:
      throw new Error(`Unknown helper ${String(testCase.fn)}`);
  }
}

function engineOutput(input: Record<string, unknown>) {
  const preflightInput = {
    ...input,
    ...(input.sourceProfile === "typst" ? { sourceRules: TYPST_SOURCE_RULES } : {}),
  } as PreflightInput;
  const report = runPreflight(preflightInput);
  return {
    findings: normalizeFindings(report.findings),
    scores: report.scores,
    coverage: report.coverage,
    atsScore: report.atsScore,
    compileScore: report.compileScore,
    a11yScore: report.a11yScore,
    refsScore: report.refsScore,
    submissionScore: report.submissionScore,
    privacyScore: report.privacyScore,
    hasPdf: report.hasPdf,
  };
}

const SUITES: [string, (testCase: Case) => unknown][] = [
  [
    "source-rules",
    (c) => normalizeFindings(runSourceRules(c.text as string, c.engine ? { engine: c.engine as PreflightEngine } : undefined)),
  ],
  [
    "refs-rules",
    (c) =>
      normalizeFindings(
        runRefsRules(
          c.source as string,
          c.ctx as RefsContext,
          (c.options as { includeProjectQuality?: boolean; file?: string } | undefined) ?? {},
        ),
      ),
  ],
  ["submission-rules", (c) => normalizeFindings(runSubmissionRules(submissionInput(c)))],
  [
    "compile-rules",
    (c) => normalizeFindings(runCompileRules(c.compile as CompileContext | undefined, c.pdf as PdfFacts | undefined)),
  ],
  [
    "typst-source-rules",
    (c) => normalizeFindings(runTypstSourceRules(c.text as string, c.version ? { version: c.version as string } : {})),
  ],
  [
    "typst-metadata",
    (c) =>
      normalizeFindings(
        typstMetadataFindings(c.sources as { path: string; content: string }[], {
          anonymousReview: c.anonymousReview as boolean,
        }),
      ),
  ],
  [
    "typst-refs-rules",
    (c) => normalizeFindings(runTypstRefsRules(c.sources as { path?: string; content: string }[], c.ctx as RefsContext)),
  ],
  ["typst-submission-rules", (c) => normalizeFindings(runTypstSubmissionRules(submissionInput(c)))],
  ["helpers", helper],
  ["engine", (c) => engineOutput(c.input as Record<string, unknown>)],
];

describe("preflight case goldens", () => {
  it.each(SUITES)("%s matches the committed golden", (suite, run) => {
    golden(suite, run);
  });
});
