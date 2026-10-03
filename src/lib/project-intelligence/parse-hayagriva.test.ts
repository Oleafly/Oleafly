import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import { citationCompletions } from "./selectors";
import { analysisEngineForPath, engineForPath, isProjectIntelligencePath } from "./source";
import type { ProjectIntelligenceSnapshot } from "./types";

function snapshot(
  sources: Readonly<Record<string, string>>,
  knownFiles: readonly string[] = Object.keys(sources),
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [file, analyzeProjectFile(file, source, 1)]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles,
    mainDocument: "main.typ",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

const LIBRARY = `harry:
  type: Book
  title: Harry Potter and the Order of the Phoenix
  author: ["Rowling, J. K."]
  date: 2003-06-21

"lovelace:2024":
  type: article
  title: "Edge Sensing"
  author:
    - "Lovelace, Ada"
    - name: Babbage
      given-name: Charles
`;

describe("Hayagriva bibliography indexing", () => {
  it("reads YAML files as candidates whose content decides whether they are sources", () => {
    expect(isProjectIntelligencePath("refs.yml")).toBe(true);
    expect(isProjectIntelligencePath("lib/refs.yaml")).toBe(true);
    expect(engineForPath("refs.YML")).toBeNull();
    expect(analysisEngineForPath("refs.YML")).toBe("bibtex");
    expect(analysisEngineForPath("figure.png")).toBeNull();
  });

  it.each([".github/workflows/ci.yml", ".gitlab-ci.yml", "pnpm-lock.yaml", "env/conda-lock.yml"])(
    "never reads %s",
    (path) => {
      expect(isProjectIntelligencePath(path)).toBe(false);
      expect(engineForPath(path)).toBeNull();
    },
  );

  it("indexes top-level keys with their display metadata", () => {
    const analysis = analyzeProjectFile("refs.yml", LIBRARY, 1);
    expect(analysis.engine).toBe("bibtex");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.definitions.filter((item) => item.kind === "bibentry").map((item) => item.name)).toEqual([
      "harry",
      "lovelace:2024",
    ]);
    const [harry, lovelace] = analysis.bibliographyEntries;
    expect(harry).toMatchObject({
      key: "harry",
      type: "book",
      author: "Rowling, J. K.",
      title: "Harry Potter and the Order of the Phoenix",
      year: "2003",
      display: "Rowling, J. K. · 2003 · Harry Potter and the Order of the Phoenix",
    });
    expect(lovelace.author).toBe("Lovelace, Ada and Babbage, Charles");
    expect(LIBRARY.slice(lovelace.keyRange.from, lovelace.keyRange.to)).toBe("lovelace:2024");
    expect(analysis.outline.map((node) => node.title)).toEqual(["harry", "lovelace:2024"]);
  });

  it("offers and resolves Hayagriva keys from a Typst document", () => {
    const value = snapshot({
      "main.typ": 'See @harry and @lovelace:2024.\n#cite(<harry>)\n#bibliography("refs.yml", title: "Works", style: "apa")\n',
      "refs.yml": LIBRARY,
    });

    expect(citationCompletions(value, "harr").map((item) => [item.key, item.title])).toEqual([
      ["harry", "Harry Potter and the Order of the Phoenix"],
    ]);
    expect(citationCompletions(value, "").map((item) => item.key)).toEqual(["harry", "lovelace:2024"]);
    const citations = value.uses.filter((use) => use.location.file === "main.typ" && use.kind === "citation");
    expect(citations.map((use) => [use.name, use.resolution])).toEqual([
      ["harry", "resolved"],
      ["lovelace:2024", "resolved"],
      ["harry", "resolved"],
    ]);
    expect(value.hierarchy.edges.filter((edge) => edge.kind === "bibliography")).toMatchObject([
      { rawTarget: "refs.yml", resolution: "resolved", targetFile: "refs.yml" },
    ]);
    expect(value.diagnostics).toEqual([]);
  });

  it("reports a key the YAML library does not define", () => {
    const value = snapshot({
      "main.typ": 'See @missing.\n#bibliography("refs.yml")\n',
      "refs.yml": LIBRARY,
    });
    expect(value.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unresolved-reference"]);
  });

  it("finds no entries in YAML that is not a Hayagriva library", () => {
    const config = "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-24.04\n";
    const analysis = analyzeProjectFile("ci.yml", config, 1);
    expect(analysis.definitions).toEqual([]);
    expect(analysis.bibliographyEntries).toEqual([]);
    expect(analysis.outline).toEqual([]);
  });

  it("resolves an asset edge to a YAML file that is known but not analysed", () => {
    const value = snapshot({ "main.typ": '#yaml("data.yml")\n' }, ["main.typ", "data.yml"]);
    expect(value.hierarchy.edges.find((edge) => edge.kind === "asset")).toMatchObject({
      resolution: "resolved",
      targetFile: "data.yml",
    });
    expect(Object.keys(value.fileStates)).toEqual(["main.typ"]);
    expect(value.diagnostics).toEqual([]);
  });
});
