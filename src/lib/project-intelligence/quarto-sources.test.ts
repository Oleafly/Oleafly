import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import type { ProjectIntelligenceSnapshot } from "./types";

function snapshot(sources: Readonly<Record<string, string>>): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [file, analyzeProjectFile(file, source, 1)]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: Object.keys(sources).find((file) => /\.(?:qmd|rmd|md)$/i.test(file)),
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

const definitionNames = (value: ProjectIntelligenceSnapshot, kind: string) =>
  value.definitions.filter((definition) => definition.kind === kind).map((definition) => definition.name);

const useNames = (value: ProjectIntelligenceSnapshot, kind: string) =>
  value.uses.filter((use) => use.kind === kind).map((use) => use.name);

const PAPER = [
  "---",
  "title: Paper",
  "bibliography: refs.bib",
  "---",
  "",
  "# Introduction",
  "",
  "```{r}",
  "#| label: fig-scatter",
  "#| echo: false",
  "# not a heading",
  "plot(1)",
  "```",
  "",
  "```{r fig-hist, echo=FALSE}",
  "hist(1)",
  "```",
  "",
  "See @fig-scatter, @fig-hist and @sec-methods, as @knuth1984 shows.",
  "",
  "## Methods {#sec-methods}",
  "",
].join("\n");

describe("Quarto sources", () => {
  it("indexes headings and chunk labels and keeps cross-references out of citations", () => {
    const value = snapshot({ "paper.qmd": PAPER, "refs.bib": "@book{knuth1984, author = {Knuth}, title = {T}, publisher = {P}, year = {1984}}\n" });
    expect(definitionNames(value, "section")).toEqual(["Introduction", "Methods"]);
    expect(definitionNames(value, "anchor")).toEqual(
      expect.arrayContaining(["fig-scatter", "fig-hist", "sec-methods"]),
    );
    expect(useNames(value, "citation")).toEqual(["knuth1984"]);
    expect(value.diagnostics).toEqual([]);
  });

  it("points a chunk label definition at the label text", () => {
    const value = snapshot({ "analysis.Rmd": PAPER });
    for (const name of ["fig-scatter", "fig-hist"]) {
      const definition = value.definitions.find((item) => item.kind === "anchor" && item.name === name);
      expect(definition).toBeDefined();
      const range = definition?.location.range;
      expect(range && PAPER.slice(range.from, range.to)).toBe(name);
    }
  });

  it("reads labels only from executable chunk headers and their option lines", () => {
    const source = [
      "```{r, echo=FALSE}",
      "#| label: fig-one",
      "x <- 1",
      "#| label: fig-late",
      "```",
      "",
      "```{.python}",
      "#| label: fig-shown",
      "```",
      "",
      "```python",
      "#| label: fig-plain",
      "```",
      "",
    ].join("\n");
    expect(definitionNames(snapshot({ "paper.qmd": source }), "anchor")).toEqual(["fig-one"]);
  });

  it("leaves Pandoc Markdown citations that look like cross-references alone", () => {
    const value = snapshot({ "notes.md": "See @fig-scatter.\n" });
    expect(useNames(value, "citation")).toEqual(["fig-scatter"]);
  });
});
