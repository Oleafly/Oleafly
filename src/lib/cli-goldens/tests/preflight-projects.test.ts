import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import {
  type CompileContext,
  detectSubmissionProfile,
  type PdfFacts,
  type PreflightEngine,
  type ProjectContext,
  runPreflight,
  type SourcePreflightProfile,
  type SubmissionProfileId,
} from "@oleafly/preflight";
import { TYPST_SOURCE_RULES, typstReferencedImages } from "@oleafly/preflight/typst";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligenceResult } from "@/lib/project-intelligence/assemble";
import { acceptsBibliographyYaml, referencedBibliographyYaml } from "@/lib/project-intelligence/bibliography-yaml";
import { legacyIndexFromProjectIntelligence } from "@/lib/project-intelligence/legacy-index";
import { isBibliographyYamlCandidate, isProjectIntelligencePath } from "@/lib/project-intelligence/source";
import type { FileAnalysis } from "@/lib/project-intelligence/types";
import { buildProjectContext, buildRefsContext } from "@/lib/preflight-context";
import {
  byCodePoint,
  expectGolden,
  normalizeEndings,
  normalizeFindings,
  PREFLIGHT_FIXTURES,
  readJson,
  walkProject,
} from "./support";

const MAX_TEXT_BYTES = 2_000_000;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_MEASURED_IMAGES = 256;

interface FixtureCase {
  name: string;
  sourceProfile: SourcePreflightProfile;
  engine: PreflightEngine;
  profile: SubmissionProfileId | null;
  anonymousReview: boolean;
  typstVersion?: string;
  buildLog?: string;
  buildStatus?: CompileContext["status"];
  pdfFacts?: string;
}

interface Fixture {
  mainDocument: string;
  cases: FixtureCase[];
}

const PROJECTS = path.join(PREFLIGHT_FIXTURES, "projects");

function readText(file: string): string {
  return normalizeEndings(new TextDecoder().decode(fs.readFileSync(file)));
}

function indexTexts(root: string, tree: readonly string[]): Record<string, string> {
  const texts: Record<string, string> = {};
  const yaml: string[] = [];
  for (const file of tree) {
    if (!isProjectIntelligencePath(file)) continue;
    if (fs.statSync(path.join(root, file)).size > MAX_TEXT_BYTES) continue;
    if (isBibliographyYamlCandidate(file) && !/\.(?:tex|ltx|latex|sty|cls|typ|md|markdown|bib)$/i.test(file)) {
      yaml.push(file);
      continue;
    }
    texts[file] = readText(path.join(root, file));
  }
  for (const file of yaml) {
    const text = readText(path.join(root, file));
    if (acceptsBibliographyYaml(text, () => referencedBibliographyYaml(texts).has(file))) texts[file] = text;
  }
  return Object.fromEntries(Object.entries(texts).sort(([left], [right]) => byCodePoint(left, right)));
}

function projectIndex(texts: Record<string, string>, tree: readonly string[], mainDocument: string) {
  const files: Record<string, FileAnalysis> = {};
  for (const [file, text] of Object.entries(texts)) files[file] = analyzeProjectFile(file, text, 1);
  const assembled = assembleProjectIntelligenceResult({
    identity: { projectId: "golden", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: [...tree],
    mainDocument,
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: Object.values(texts).reduce((sum, text) => sum + text.length, 0),
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
  return legacyIndexFromProjectIntelligence(assembled.snapshot);
}

function withImageSizes(root: string, project: ProjectContext): ProjectContext {
  const requested = [...new Set(typstReferencedImages(project))].slice(0, MAX_MEASURED_IMAGES);
  const sizes = new Map<string, number>();
  for (const file of requested) {
    const full = path.join(root, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) sizes.set(file, fs.statSync(full).size);
  }
  return {
    ...project,
    files: project.files.map((file) => {
      const size = sizes.get(file.path);
      return size === undefined ? file : { ...file, size };
    }),
  };
}

function readLog(file: string): string {
  return normalizeEndings(new TextDecoder().decode(fs.readFileSync(file).subarray(0, MAX_LOG_BYTES)));
}

function fixtureNames(): string[] {
  return fs
    .readdirSync(PROJECTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(byCodePoint);
}

describe("preflight project goldens", () => {
  it.each(fixtureNames())("%s matches the committed goldens", (name) => {
    const base = path.join(PROJECTS, name);
    const fixture = readJson<Fixture>(path.join(base, "fixture.json"));
    const root = path.join(base, "project");
    const tree = walkProject(root);
    const texts = indexTexts(root, tree);
    const index = projectIndex(texts, tree, fixture.mainDocument);
    const input = { mainDoc: fixture.mainDocument, treePaths: tree, indexTexts: texts, openTexts: {}, index };
    const refs = buildRefsContext(input);
    const baseProject = buildProjectContext(input);
    const facts = readJson<Record<string, PdfFacts>>(path.join(PREFLIGHT_FIXTURES, "expected", "pdf-facts.json"));
    for (const testCase of fixture.cases) {
      const mainText = texts[fixture.mainDocument] ?? "";
      const typst = testCase.sourceProfile === "typst";
      const project = typst ? withImageSizes(root, baseProject) : baseProject;
      const compile = testCase.buildLog
        ? { status: testCase.buildStatus ?? "success", log: readLog(path.join(root, testCase.buildLog)) }
        : undefined;
      const pdf = testCase.pdfFacts ? facts[testCase.pdfFacts] : undefined;
      if (testCase.pdfFacts && !pdf) throw new Error(`No PDF facts for ${testCase.pdfFacts}`);
      const profile = testCase.profile ?? detectSubmissionProfile(mainText);
      const report = runPreflight({
        source: mainText,
        sourceProfile: testCase.sourceProfile,
        ...(typst ? { sourceRules: TYPST_SOURCE_RULES } : {}),
        ...(typst && testCase.typstVersion ? { typstVersion: testCase.typstVersion } : {}),
        refs,
        project,
        ...(compile ? { compile } : {}),
        submissionProfile: profile,
        anonymousReview: testCase.anonymousReview,
        engine: testCase.engine,
        ...(pdf ? { facts: pdf } : {}),
      });
      expectGolden(path.join(base, "expected", `${testCase.name}.json`), {
        profile,
        refs: testCase.sourceProfile === "none" ? null : refs,
        project: {
          mainFile: project.mainFile,
          files: project.files.map((file) => ({
            path: file.path,
            hasContent: file.content !== undefined,
            ...(file.size !== undefined ? { size: file.size } : {}),
          })),
        },
        report: {
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
        },
      });
    }
  });
});
