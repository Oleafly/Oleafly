import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import { fileIntelligenceFor, fileIntelligenceView } from "./file-view";
import { analyzeSeedProject, canonicalJson, sha256 } from "./seed-fixture";
import type {
  BibliographyEntry,
  FileIntelligence,
  ProjectIntelligenceSnapshot,
} from "./types";

const GOLDEN_FILE_DIGESTS: Readonly<Record<string, string>> = {
  "appendices/lattice-coefficients.tex":
    "3d0521fcf97ed48d91fb0480980a0b687b481e62d20b5b3b165b72f91e77deaf",
  "appendices/solver-configuration.tex":
    "4cc18255674b76fc35e06d00c9e26b4ef1478f15967d1b01ee156763748159fd",
  "chapters/conclusion.tex":
    "51724cf3e1187dcb997cb4b39de054fe6ae32a699cc07b67941a68549a71e398",
  "chapters/introduction.tex":
    "acfd1f1c51f49e77826dce8d413f2d956968bd73ea1778e91b87966da6226a58",
  "chapters/method.tex":
    "ea553a2d378b554e9bd848fb8e882f8703b4af170b49e69bef72b05d8add4fc6",
  "chapters/results.tex":
    "a978cd2edd071925b1954a7f3a33c02ecd2bb673b9fe860a33c6695c5b6fae41",
  "chapters/theory.tex":
    "1d91a86054926cfc1cbbf6bedfb0d46fedcc412a3b04543fd635baf2bf1790a1",
  "chapters/validation.tex":
    "d4fcada11848a84be6758953a191f57a8814001d89bf5e85fd480899286a8fdf",
  "frontmatter/abstract.tex":
    "9ce0f5933583943e442c7590c31da9bb9877d529d8d70f8f4b0a172b62ff3cd9",
  "frontmatter/acknowledgements.tex":
    "19169789aa93eab1c65b0c20b6a461020efc38ed9c81d34728b3cb485421c720",
  "frontmatter/titlepage.tex":
    "2bfb49a2317d3f4a0900df9ddbce6dccf9a5364ec26db8e5192eab67bfbea5ad",
  "main.tex":
    "9a6478ce693e29035931f82dc586a03cb9dc9651555d638fb4e84cd48ed50e73",
  "refs.bib":
    "83349285f7ee030e7f59fe47213264a25027ced57ae21b70bbd8bef234fcfc95",
};
const GOLDEN_ALL_DIGEST =
  "cfe94af00496e822eaa024d138445906a3d8f7f284ba512d872ed43e84a051e9";

function byPosition(
  left: { readonly id: string; readonly range?: { readonly from: number }; readonly location?: { readonly range: { readonly from: number } } },
  right: typeof left,
): number {
  const leftFrom = (left.range ?? left.location?.range)?.from ?? 0;
  const rightFrom = (right.range ?? right.location?.range)?.from ?? 0;
  return leftFrom - rightFrom || left.id.localeCompare(right.id);
}

function legacyEntryProjection(entry: BibliographyEntry) {
  return {
    id: entry.id,
    key: entry.key,
    type: entry.type,
    file: entry.file,
    range: entry.range,
    keyRange: entry.keyRange,
    complete: entry.complete,
    duplicate: entry.duplicate,
    duplicateIndex: entry.duplicateIndex,
    duplicateCount: entry.duplicateCount,
  };
}

function projection(file: FileIntelligence) {
  return {
    ...file,
    definitions: [...file.definitions].sort(byPosition),
    outline: [...file.outline].sort(byPosition),
    bibliographyEntries: file.bibliographyEntries.map(legacyEntryProjection),
  };
}

function snapshotFor(
  sources: Readonly<Record<string, string>>,
  projectRevision = 1,
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [
      file,
      analyzeProjectFile(file, source, projectRevision),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "view", projectRevision, requestGeneration: projectRevision },
    files,
    knownFiles: Object.keys(sources).sort(),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

describe("lazy per-file intelligence view", () => {
  it("reproduces the per-file records the worker used to copy into the snapshot", () => {
    const seed = analyzeSeedProject("computational-physics-phd-thesis");
    const view = fileIntelligenceView(seed.snapshot);
    const projected: Record<string, unknown> = {};
    for (const file of Object.keys(GOLDEN_FILE_DIGESTS)) {
      const value = projection(view[file]);
      projected[file] = value;
      expect(sha256(canonicalJson(value)), file).toBe(
        GOLDEN_FILE_DIGESTS[file],
      );
    }
    expect(Object.keys(view).sort()).toEqual(
      Object.keys(GOLDEN_FILE_DIGESTS).sort(),
    );
    expect(sha256(canonicalJson(projected))).toBe(GOLDEN_ALL_DIGEST);
  });

  it("keeps every flattened record reachable exactly once through the view", () => {
    const seed = analyzeSeedProject("computational-physics-phd-thesis");
    const view = fileIntelligenceView(seed.snapshot);
    const files = Object.values(view);
    expect(files.flatMap((file) => file.uses)).toEqual(seed.snapshot.uses);
    expect(files.flatMap((file) => file.edges)).toEqual(
      seed.snapshot.hierarchy.edges,
    );
    expect(files.flatMap((file) => file.diagnostics)).toEqual(
      seed.snapshot.diagnostics,
    );
    expect(
      files.flatMap((file) => file.definitions).length,
    ).toBe(seed.snapshot.definitions.length);
    expect(files.flatMap((file) => file.bibliographyEntries)).toEqual(
      seed.snapshot.bibliography.entries,
    );
    for (const file of files) {
      expect(file.outline).toBe(seed.snapshot.outlines[file.file]);
    }
  });

  it("builds a file on first access, reuses it, and scopes the cache to one snapshot", () => {
    const sources = {
      "main.tex": String.raw`\section{Intro}\label{sec:intro}\ref{sec:intro}\cite{alpha}\input{chapter}`,
      "chapter.tex": String.raw`\label{ch}\ref{missing}`,
      "refs.bib": "@misc{alpha, title={Alpha}, author={A}, year={2020}}",
    };
    const first = snapshotFor(sources);
    expect(fileIntelligenceFor(first, "nope.tex")).toBeNull();
    const main = fileIntelligenceFor(first, "main.tex");
    expect(main).not.toBeNull();
    expect(fileIntelligenceFor(first, "main.tex")).toBe(main);
    expect(fileIntelligenceView(first)["main.tex"]).toBe(main);
    expect(fileIntelligenceView(first)).toBe(fileIntelligenceView(first));
    expect(main?.uses.map((use) => use.kind)).toEqual([
      "reference",
      "citation",
      "include",
    ]);
    expect(main?.edges.map((edge) => edge.targetFile)).toEqual([
      "chapter.tex",
    ]);
    expect(main?.definitions.map((definition) => definition.name)).toEqual(
      expect.arrayContaining(["Intro", "sec:intro"]),
    );
    const chapter = fileIntelligenceFor(first, "chapter.tex");
    expect(chapter?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unresolved-reference",
    ]);
    const bib = fileIntelligenceFor(first, "refs.bib");
    expect(bib?.bibliographyEntries.map((entry) => entry.display)).toEqual([
      "A · 2020 · Alpha",
    ]);
    expect(bib?.status).toBe(first.fileStates["refs.bib"].status);
    expect(bib?.sourceRevision).toBe(1);

    const second = snapshotFor(sources, 2);
    expect(fileIntelligenceFor(second, "main.tex")).not.toBe(main);
    expect(fileIntelligenceFor(second, "main.tex")?.sourceRevision).toBe(2);
    expect(fileIntelligenceFor(first, "main.tex")).toBe(main);
  });
});
