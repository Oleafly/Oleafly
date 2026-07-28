import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIndex } from "./index/build";
import type { ProjectIndex, Sym } from "./index/types";
import { parseBib } from "./latex-tools";

type EngineName = "latex" | "markdown" | "typst" | "bibtex";
type Surface = "source" | "visual" | "pdf";
type EvidenceType = "unit" | "integration" | "end-to-end" | "fixture" | "performance";
type FixtureMarker =
  | "include"
  | "reference"
  | "citation"
  | "inline-math"
  | "display-math"
  | "proofing"
  | "malformed/incomplete"
  | "bib-entry";
type RelationshipKind = "include" | "reference" | "citation" | "bibliography" | "bib-entry";

interface Applicability {
  engine: EngineName;
  surfaces: Surface[];
  extensions: string[];
}

interface ApplicabilityTuple {
  featureId: string;
  engine: EngineName;
  surface: Surface;
  extension: string;
}

interface AcceptanceCriterion {
  id: string;
  statement: string;
  requiredEvidence: EvidenceType[];
}

interface FeatureContract {
  id: string;
  name: string;
  required: boolean;
  applicability: Applicability[];
  acceptanceCriteria: AcceptanceCriterion[];
}

interface FixtureRelationship {
  kind: RelationshipKind;
  name: string;
  target: string;
}

interface FixtureContract {
  path: string;
  engine: EngineName;
  markers: FixtureMarker[];
  relationships: FixtureRelationship[];
}

interface EngineContract {
  surfaceExtensions: Partial<Record<Surface, string[]>>;
  excludedCapabilities?: string[];
}

interface EditorSupportContract {
  schemaVersion: number;
  definition: {
    scorePercent: number;
    requiresAllAcceptanceCriteria: boolean;
  };
  releasePlatforms: string[];
  surfaces: Surface[];
  evidenceTypes: Array<{ id: EvidenceType; meaning: string }>;
  features: FeatureContract[];
  engines: Record<EngineName, EngineContract> & {
    excludedExtensions: string[];
  };
  proofing: {
    grammar: {
      language: string;
      dialects: Array<{ name: string; locale: string }>;
    };
    spelling: {
      baselinePack: string;
      dictionaryDirectory: string;
      shippedPackDefinition: {
        requiredFiles: string[];
        sameBasename: boolean;
      };
      releaseScope: string;
      requiredChecks: string[];
      releaseBlockingConditions: string[];
      requestedUnavailablePackState: string;
      fallbackPolicy: string;
    };
  };
  visibleStateTaxonomy: Array<{
    id: string;
    kind: "state" | "modifier";
    meaning: string;
    requiredPresentation: string;
  }>;
  resultPolicies: {
    analysisProofingParse: {
      staleResponseDisposition: string;
    };
    compilePdfLoad: {
      revisionIdentity: {
        field: string;
        scope: string;
        appliesTo: string[];
        acceptOnlyWhenCapturedEqualsCurrent: boolean;
        advancesOnChangesTo: string[];
      };
      staleResponseDisposition: string;
      lastGoodPdf: {
        retentionAllowedWhileNewerRevision: string[];
        requiredVisibleModifiers: string[];
        currentRevisionClaim: string;
      };
    };
    limits: {
      silentCutoffs: string;
      timeouts: string;
      emptySuccessRequires: string;
    };
  };
  performance: {
    referenceHardware: {
      machine: string;
      chip: string;
      modelYear: number;
      cpuCores: number;
      memoryGiB: number;
      storage: string;
      operatingSystem: string;
      power: string;
    };
    methodology: {
      warmupRuns: number;
      measuredRuns: number;
      statistic: string;
    };
    functionalCrossPlatformGates: string;
    referenceProject: {
      maxFiles: number;
      totalCharacters: number;
    };
    singleDocumentStressCharacters: number;
    maxMainThreadTaskMs: number;
    completionCachedP95Ms: number;
    completionProjectBackedP95Ms: number;
    syntaxVisibleUpdateP95Ms: number;
    diagnosticsStructureP95Ms: number;
    idleDebounceMs: number;
    proofing100kMs: number;
    proofing500kMs: number;
    inlineMathIdleMs: number;
    autoCompileStartMs: number;
  };
  fixtures: FixtureContract[];
}

interface MarkdownFeature {
  id: string;
  name: string;
  acceptanceCriteria: Array<{ id: string; statement: string }>;
}

const fixtureRoot = fileURLToPath(
  new URL("../../test/fixtures/editor-support/", import.meta.url),
);
const specPath = fileURLToPath(
  new URL(
    "../../docs/planning/specs/2026-07-27-editor-support-acceptance-design.md",
    import.meta.url,
  ),
);
const contract = JSON.parse(
  readFileSync(resolve(fixtureRoot, "contract.json"), "utf8"),
) as EditorSupportContract;
const specification = readFileSync(specPath, "utf8");

function markdownSection(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) throw new Error(`Missing Markdown section ${heading}`);
  return markdown.slice(start + heading.length, end);
}

function extractPurposeFeatureNames(markdown: string): string[] {
  const purpose = markdownSection(markdown, "## 1. Purpose", "## 2. Exact meaning of 100%");
  return [...purpose.matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1].trim());
}

function extractMarkdownFeatures(markdown: string): MarkdownFeature[] {
  const featureSection = markdownSection(markdown, "## 7. Per-feature release criteria", "## 8. Acceptance evidence");
  const headings = [...featureSection.matchAll(/^### 7\.\d+ (.+)$/gm)];
  return headings.map((heading, index) => {
    const bodyStart = (heading.index ?? 0) + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? featureSection.length;
    const body = featureSection.slice(bodyStart, bodyEnd);
    const id = body.match(/^\*\*Feature ID:\*\* `([^`]+)`$/m)?.[1];
    if (!id) throw new Error(`Missing feature ID for ${heading[1]}`);

    const acceptanceCriteria: Array<{ id: string; statement: string }> = [];
    let current: { id: string; parts: string[] } | undefined;
    const flush = () => {
      if (!current) return;
      acceptanceCriteria.push({
        id: current.id,
        statement: current.parts.join(" ").replace(/\s+/g, " ").trim(),
      });
    };
    for (const line of body.split("\n")) {
      const criterion = /^\d+\. \*\*`([^`]+)`\*\* — (.+)$/.exec(line);
      if (criterion) {
        flush();
        current = { id: criterion[1], parts: [criterion[2].trim()] };
      } else if (current && line.startsWith("   ")) {
        current.parts.push(line.trim());
      }
    }
    flush();
    return { id, name: heading[1].trim(), acceptanceCriteria };
  });
}

function extractMarkdownTable(
  markdown: string,
  header: string,
): Array<Record<string, string>> {
  const lines = markdown.split("\n");
  const headerIndex = lines.indexOf(header);
  if (headerIndex < 0) throw new Error(`Missing Markdown table ${header}`);
  const keys = header
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    rows.push(Object.fromEntries(keys.map((key, index) => [key, cells[index]])));
  }
  return rows;
}

function sortApplicabilityTuples(tuples: ApplicabilityTuple[]): ApplicabilityTuple[] {
  return tuples.sort((left, right) =>
    [
      left.featureId,
      left.engine,
      left.surface,
      left.extension,
    ].join("\0").localeCompare(
      [right.featureId, right.engine, right.surface, right.extension].join("\0"),
    ),
  );
}

function markdownApplicabilityTuples(markdown: string): ApplicabilityTuple[] {
  const rows = extractMarkdownTable(
    markdown,
    "| Feature ID | Engine | Surfaces | Extensions |",
  );
  return sortApplicabilityTuples(
    rows.flatMap((row) => {
      const surfaces = row.Surfaces.split(",").map((surface) => surface.trim() as Surface);
      const extensions = row.Extensions.split(",").map((extension) => extension.trim());
      return surfaces.flatMap((surface) =>
        extensions.map((extension) => ({
          featureId: row["Feature ID"],
          engine: row.Engine as EngineName,
          surface,
          extension,
        })),
      );
    }),
  );
}

function contractApplicabilityTuples(features: FeatureContract[]): ApplicabilityTuple[] {
  return sortApplicabilityTuples(
    features.flatMap(({ id: featureId, applicability }) =>
      applicability.flatMap(({ engine, surfaces, extensions }) =>
        surfaces.flatMap((surface) =>
          extensions.map((extension) => ({
            featureId,
            engine,
            surface,
            extension,
          })),
        ),
      ),
    ),
  );
}

function hasTextMarker(source: string, marker: FixtureMarker): boolean {
  switch (marker) {
    case "inline-math":
      return (
        /\\\([\s\S]*?\\\)/.test(source) ||
        /(^|[^$])\$[^$\n]+\$(?!\$)/m.test(source)
      );
    case "display-math":
      return (
        /\\\[[\s\S]*?\\\]/.test(source) ||
        /(?:^|\n)\$\$[\s\S]*?\$\$(?:\n|$)/.test(source) ||
        /(?:^|\n)\$\n[\s\S]*?\n\$(?:\n|$)/.test(source)
      );
    case "proofing":
      return (
        /\b(definately|usefull)\b/i.test(source) &&
        /\b(This results is|paragraph have)\b/i.test(source)
      );
    case "malformed/incomplete": {
      const openBraces = source.match(/\{/g)?.length ?? 0;
      const closeBraces = source.match(/\}/g)?.length ?? 0;
      const beginEnvironments = source.match(/\\begin\{/g)?.length ?? 0;
      const endEnvironments = source.match(/\\end\{/g)?.length ?? 0;
      return openBraces !== closeBraces || beginEnvironments !== endEnvironments;
    }
    case "include":
    case "reference":
    case "citation":
    case "bib-entry":
      return false;
  }
}

function relationshipForMarker(marker: FixtureMarker): RelationshipKind | undefined {
  switch (marker) {
    case "include":
    case "reference":
    case "citation":
    case "bib-entry":
      return marker;
    case "inline-math":
    case "display-math":
    case "proofing":
    case "malformed/incomplete":
      return undefined;
  }
}

function resolvedUse(
  index: ProjectIndex,
  fixture: FixtureContract,
  relationship: FixtureRelationship,
): { use: Sym; definition: Sym } | undefined {
  const useKinds =
    relationship.kind === "citation"
      ? fixture.engine === "typst"
        ? ["atuse"]
        : ["cite"]
      : fixture.engine === "typst"
        ? ["atuse"]
        : ["ref"];
  const use = index.uses.find(
    (candidate) =>
      candidate.file === fixture.path &&
      useKinds.includes(candidate.kind) &&
      candidate.name === relationship.name,
  );
  if (!use) return undefined;
  const definition = index.definitionFor(use);
  return definition ? { use, definition } : undefined;
}

function markdownLinkResolves(
  source: string,
  fixturePath: string,
  relationship: FixtureRelationship,
): boolean {
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const [rawPath, fragment] = match[1].split("#", 2);
    const target = posix.normalize(posix.join(posix.dirname(fixturePath), rawPath));
    if (target === relationship.target && fragment === relationship.name) return true;
  }
  return false;
}

describe("editor support acceptance contract", () => {
  it("mirrors all nine Markdown features and acceptance criteria by stable ID", () => {
    const purposeNames = extractPurposeFeatureNames(specification);
    const markdownFeatures = extractMarkdownFeatures(specification);

    expect(purposeNames).toHaveLength(9);
    expect(markdownFeatures.map(({ name }) => name)).toEqual(purposeNames);
    expect(contract.features.map(({ name }) => name)).toEqual(purposeNames);
    expect(
      contract.features.map(({ id, name, acceptanceCriteria }) => ({
        id,
        name,
        acceptanceCriteria: acceptanceCriteria.map(({ id: criterionId, statement }) => ({
          id: criterionId,
          statement,
        })),
      })),
    ).toEqual(markdownFeatures);

    const featureIds = contract.features.map(({ id }) => id);
    const criterionIds = contract.features.flatMap(({ acceptanceCriteria }) =>
      acceptanceCriteria.map(({ id }) => id),
    );
    expect(new Set(featureIds).size).toBe(featureIds.length);
    expect(new Set(criterionIds).size).toBe(criterionIds.length);
    expect(featureIds.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
    expect(criterionIds.every((id) => /^[A-Z]{3}-\d{2}$/.test(id))).toBe(true);
    expect(contract.features.every(({ required }) => required)).toBe(true);
    expect(contract.features.every(({ acceptanceCriteria }) => acceptanceCriteria.length === 4)).toBe(
      true,
    );
  });

  it("uses the closed evidence vocabulary for every required criterion", () => {
    const evidenceTable = extractMarkdownTable(specification, "| Evidence ID | Meaning |").map(
      (row) => ({
        id: row["Evidence ID"],
        meaning: row.Meaning,
      }),
    );
    expect(contract.evidenceTypes).toEqual(evidenceTable);

    const evidenceIds = new Set(contract.evidenceTypes.map(({ id }) => id));
    for (const criterion of contract.features.flatMap(({ acceptanceCriteria }) => acceptanceCriteria)) {
      expect(criterion.requiredEvidence.length, `${criterion.id} needs evidence`).toBeGreaterThan(0);
      expect(new Set(criterion.requiredEvidence).size, `${criterion.id} evidence must be unique`).toBe(
        criterion.requiredEvidence.length,
      );
      for (const evidence of criterion.requiredEvidence) {
        expect(evidenceIds, `${criterion.id} uses unknown evidence ${evidence}`).toContain(evidence);
      }
    }
  });

  it("exactly mirrors the complete Markdown applicability matrix", () => {
    expect(contract.schemaVersion).toBe(2);
    expect(contract.definition).toEqual({
      scorePercent: 100,
      requiresAllAcceptanceCriteria: true,
    });
    expect(contract.releasePlatforms).toEqual(["macos", "windows", "linux"]);
    expect(contract.surfaces).toEqual(["source", "visual", "pdf"]);
    expect(contractApplicabilityTuples(contract.features)).toEqual(
      markdownApplicabilityTuples(specification),
    );

    for (const featureContract of contract.features) {
      expect(featureContract.applicability.length, `${featureContract.id} needs applicability`).toBeGreaterThan(
        0,
      );
      for (const applicability of featureContract.applicability) {
        expect(Object.keys(applicability).sort()).toEqual(
          ["engine", "surfaces", "extensions"].sort(),
        );
        expect(applicability.surfaces.length).toBeGreaterThan(0);
        expect(applicability.extensions.length).toBeGreaterThan(0);
        for (const surface of applicability.surfaces) {
          expect(contract.surfaces).toContain(surface);
          const routedExtensions =
            contract.engines[applicability.engine].surfaceExtensions[surface];
          expect(
            routedExtensions,
            `${featureContract.id}: ${applicability.engine}/${surface} must be globally routed`,
          ).toBeDefined();
          for (const extension of applicability.extensions) {
            expect(routedExtensions).toContain(extension);
          }
        }
      }
    }

    expect(Object.keys(contract.engines.bibtex.surfaceExtensions)).toEqual(["source"]);
    expect(contract.engines.typst.excludedCapabilities).toEqual(["visual", "inline-preview"]);
  });

  it("mirrors dialect locales, visible states, and shipped-dictionary semantics", () => {
    const dialects = extractMarkdownTable(specification, "| Dialect | Locale |").map((row) => ({
      name: row.Dialect,
      locale: row.Locale,
    }));
    expect(contract.proofing.grammar).toEqual({
      language: "English",
      dialects,
    });

    const visibleStates = extractMarkdownTable(
      specification,
      "| ID | Kind | Meaning | Required presentation |",
    ).map((row) => ({
      id: row.ID,
      kind: row.Kind,
      meaning: row.Meaning,
      requiredPresentation: row["Required presentation"],
    }));
    expect(contract.visibleStateTaxonomy).toEqual(visibleStates);

    expect(contract.proofing.spelling).toEqual({
      baselinePack: "en-US",
      dictionaryDirectory: "public/dictionaries",
      shippedPackDefinition: {
        requiredFiles: [".aff", ".dic"],
        sameBasename: true,
      },
      releaseScope: "all-shipped-paired-packs",
      requiredChecks: [
        "load",
        "known-word",
        "known-misspelling",
        "suggestions",
        "user-dictionary",
      ],
      releaseBlockingConditions: [
        "missing-baseline-pack",
        "orphaned-aff",
        "orphaned-dic",
        "pack-load-failure",
      ],
      requestedUnavailablePackState: "unavailable",
      fallbackPolicy: "allowed-only-with-truthful-active-pack-label",
    });
    expect(contract.visibleStateTaxonomy.some(({ id }) => id === "unavailable")).toBe(true);
  });

  it("encodes stale-result and retained-PDF policy without ambiguous flags", () => {
    expect(contract).not.toHaveProperty("failures");
    expect(contract.resultPolicies).toEqual({
      analysisProofingParse: {
        staleResponseDisposition: "reject-without-commit",
      },
      compilePdfLoad: {
        revisionIdentity: {
          field: "projectRevision",
          scope: "whole-project",
          appliesTo: ["compile-result", "pdf-load-result"],
          acceptOnlyWhenCapturedEqualsCurrent: true,
          advancesOnChangesTo: [
            "main-document",
            "included-files",
            "imported-files",
            "bibliographies",
            "assets",
          ],
        },
        staleResponseDisposition: "reject-without-replacing-accepted-pdf",
        lastGoodPdf: {
          retentionAllowedWhileNewerRevision: ["pending", "failed"],
          requiredVisibleModifiers: ["stale", "non_current"],
          currentRevisionClaim: "forbidden",
        },
      },
      limits: {
        silentCutoffs: "forbidden",
        timeouts: "error",
        emptySuccessRequires: "complete-current-revision-run",
      },
    });
    const normalizedSpecification = specification.replace(/\s+/g, " ");
    expect(normalizedSpecification).toContain(
      "Compile and PDF-load results capture `projectRevision` and are accepted only when the captured `projectRevision` equals the current `projectRevision`.",
    );
    expect(normalizedSpecification).toContain(
      "changes to the main document, included or imported files, bibliographies, or assets advance `projectRevision`.",
    );
    expect(JSON.stringify(contract.resultPolicies.compilePdfLoad)).not.toContain("sourceRevision");
    const taxonomyIds = new Set(contract.visibleStateTaxonomy.map(({ id }) => id));
    for (const modifier of contract.resultPolicies.compilePdfLoad.lastGoodPdf
      .requiredVisibleModifiers) {
      expect(taxonomyIds).toContain(modifier);
    }
  });

  it("pins objective budgets and the fixed reference-hardware methodology", () => {
    expect(contract.performance.referenceHardware).toEqual({
      machine: "Mac mini",
      chip: "M1",
      modelYear: 2020,
      cpuCores: 8,
      memoryGiB: 16,
      storage: "SSD",
      operatingSystem: "macOS 15",
      power: "AC",
    });
    expect(contract.performance.methodology).toEqual({
      warmupRuns: 3,
      measuredRuns: 20,
      statistic: "p95",
    });
    expect(contract.performance.functionalCrossPlatformGates).toBe("separate");
    const projectCompletionBudget = Number(
      specification.match(/\| Project-backed completion \| p95 at or below (\d+) ms \|/)?.[1],
    );
    expect(projectCompletionBudget).toBeGreaterThan(0);
    expect(contract.performance.completionProjectBackedP95Ms).toBe(projectCompletionBudget);
    expect(contract.performance).toMatchObject({
      referenceProject: {
        maxFiles: 200,
        totalCharacters: 500_000,
      },
      singleDocumentStressCharacters: 500_000,
      maxMainThreadTaskMs: 50,
      completionCachedP95Ms: 100,
      syntaxVisibleUpdateP95Ms: 50,
      diagnosticsStructureP95Ms: 750,
      idleDebounceMs: 300,
      proofing100kMs: 2_000,
      proofing500kMs: 8_000,
      inlineMathIdleMs: 500,
      autoCompileStartMs: 3_000,
    });
  });

  it("validates real fixture relationships through project parsers and builders", () => {
    const declaredMarkers = new Set<FixtureMarker>();
    const fixtureSources = new Map<string, string>();

    for (const fixture of contract.fixtures) {
      const fixturePath = resolve(fixtureRoot, fixture.path);
      const relativePath = relative(fixtureRoot, fixturePath);
      expect(
        isAbsolute(relativePath) || relativePath.startsWith(".."),
        `${fixture.path} must stay inside the fixture root`,
      ).toBe(false);
      expect(existsSync(fixturePath), `${fixture.path} must exist`).toBe(true);
      expect(statSync(fixturePath).isFile(), `${fixture.path} must be a file`).toBe(true);
      expect(
        contract.engines[fixture.engine].surfaceExtensions.source,
        `${fixture.path} must use a ${fixture.engine} extension`,
      ).toContain(extname(fixturePath).toLowerCase());

      const source = readFileSync(fixturePath, "utf8");
      fixtureSources.set(fixture.path, source);
      for (const marker of fixture.markers) {
        declaredMarkers.add(marker);
        const relationshipKind = relationshipForMarker(marker);
        if (relationshipKind) {
          expect(
            fixture.relationships.some(({ kind }) => kind === relationshipKind),
            `${fixture.path} must declare a real ${marker} relationship`,
          ).toBe(true);
        } else {
          expect(hasTextMarker(source, marker), `${fixture.path} must contain ${marker}`).toBe(true);
        }
      }
    }

    expect([...declaredMarkers].sort()).toEqual(
      [
        "include",
        "reference",
        "citation",
        "inline-math",
        "display-math",
        "proofing",
        "malformed/incomplete",
        "bib-entry",
      ].sort(),
    );

    const projectFiles = Object.fromEntries(fixtureSources);
    const projectIndex = buildIndex(projectFiles);
    const declaredFixturePaths = new Set(contract.fixtures.map(({ path }) => path));

    for (const fixture of contract.fixtures) {
      const source = fixtureSources.get(fixture.path) ?? "";
      for (const relationship of fixture.relationships) {
        expect(
          declaredFixturePaths,
          `${fixture.path} relationship target must be a declared fixture`,
        ).toContain(relationship.target);

        if (relationship.kind === "include") {
          const edge = projectIndex.uses.find(
            ({ file, kind, name, target }) =>
              file === fixture.path &&
              kind === "inputedge" &&
              name === relationship.name &&
              target === relationship.target,
          );
          expect(edge, `${fixture.path} must include ${relationship.target}`).toBeDefined();
          expect(edge && projectIndex.definitionFor(edge)?.file).toBe(relationship.target);
        } else if (relationship.kind === "reference") {
          if (fixture.engine === "markdown") {
            expect(
              markdownLinkResolves(source, fixture.path, relationship),
              `${fixture.path} must link to ${relationship.target}#${relationship.name}`,
            ).toBe(true);
            expect(
              projectIndex.defs.some(
                ({ kind, name, file }) =>
                  kind === "label" &&
                  name === relationship.name &&
                  file === relationship.target,
              ),
            ).toBe(true);
          } else {
            const resolved = resolvedUse(projectIndex, fixture, relationship);
            expect(resolved?.definition).toMatchObject({
              kind: "label",
              name: relationship.name,
              file: relationship.target,
            });
          }
        } else if (relationship.kind === "citation") {
          const resolved = resolvedUse(projectIndex, fixture, relationship);
          expect(resolved?.definition).toMatchObject({
            kind: "bibentry",
            name: relationship.name,
            file: relationship.target,
          });
        } else if (relationship.kind === "bibliography") {
          const hasDeclaration =
            fixture.engine === "typst"
              ? source.includes(`#bibliography("${relationship.name}")`)
              : source.includes(`\\bibliography{${relationship.name}}`);
          expect(hasDeclaration, `${fixture.path} must declare ${relationship.name}`).toBe(true);
          const bibliographyName = extname(relationship.name)
            ? relationship.name
            : `${relationship.name}.bib`;
          expect(
            posix.normalize(posix.join(posix.dirname(fixture.path), bibliographyName)),
          ).toBe(relationship.target);
        } else {
          expect(
            projectIndex.defs.some(
              ({ kind, name, file }) =>
                kind === "bibentry" &&
                name === relationship.name &&
                file === relationship.target,
            ),
          ).toBe(true);
        }
      }
    }

    const bibliographySource = fixtureSources.get("project/references.bib") ?? "";
    const parsedBibliography = parseBib(bibliographySource);
    expect(parsedBibliography.parseErrors).toEqual([]);
    expect(parsedBibliography.entries.map(({ key }) => key).sort()).toEqual(
      contract.fixtures
        .flatMap(({ relationships }) => relationships)
        .filter(({ kind }) => kind === "bib-entry")
        .map(({ name }) => name)
        .sort(),
    );

    const typstFixture = contract.fixtures.find(({ engine }) => engine === "typst");
    if (!typstFixture) throw new Error("Missing Typst fixture");
    const typstReference = resolvedUse(
      projectIndex,
      typstFixture,
      typstFixture.relationships.find(({ kind }) => kind === "reference") as FixtureRelationship,
    );
    const typstCitation = resolvedUse(
      projectIndex,
      typstFixture,
      typstFixture.relationships.find(({ kind }) => kind === "citation") as FixtureRelationship,
    );
    expect(typstReference?.definition.kind).toBe("label");
    expect(typstCitation?.definition.kind).toBe("bibentry");

    const malformedSource = fixtureSources.get("project/malformed.tex") ?? "";
    expect(() => buildIndex({ "project/malformed.tex": malformedSource })).not.toThrow();
    const malformedIndex = buildIndex({ "project/malformed.tex": malformedSource });
    expect(malformedIndex.uses.some(({ kind }) => kind === "envuse")).toBe(true);
  });
});
