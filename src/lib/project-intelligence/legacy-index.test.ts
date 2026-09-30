import { describe, expect, it, vi } from "vitest";
import { indexFromSymbols } from "@/lib/index/build";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import {
  lazyLegacyIndex,
  legacyIndexFromProjectIntelligence,
} from "./legacy-index";
import type { ProjectIntelligenceSnapshot } from "./types";

vi.mock("@/lib/index/build", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/index/build")>();
  return {
    ...original,
    indexFromSymbols: vi.fn(original.indexFromSymbols),
  };
});

function snapshot(
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
    identity: { projectId: "legacy", projectRevision, requestGeneration: projectRevision },
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

const sources = {
  "main.tex": String.raw`\section{Intro}\label{sec:intro}\ref{sec:intro}\cite{alpha}\input{chapter}`,
  "chapter.tex": String.raw`\newcommand{\vec}{x}\vec`,
  "notes.md": "# Heading\n\nSee [link](#heading).\n",
  "refs.bib": "@misc{alpha, title={Alpha}}",
};

describe("lazy legacy project index", () => {
  it("builds the closure index once on first use and reuses it for the same snapshot", () => {
    const value = snapshot(sources);
    vi.mocked(indexFromSymbols).mockClear();
    const lazy = lazyLegacyIndex(value);
    expect(indexFromSymbols).not.toHaveBeenCalled();
    expect(lazyLegacyIndex(value)).toBe(lazy);
    expect(indexFromSymbols).not.toHaveBeenCalled();

    const defs = lazy.defs;
    expect(indexFromSymbols).toHaveBeenCalledTimes(1);
    expect(lazy.symbolAt("main.tex", 3)?.kind).toBe("section");
    expect(lazy.uses.length).toBeGreaterThan(0);
    expect(lazy.references("sec:intro", "ref")).toHaveLength(1);
    expect(lazy.defs).toBe(defs);
    expect(indexFromSymbols).toHaveBeenCalledTimes(1);

    const eager = legacyIndexFromProjectIntelligence(value);
    expect(indexFromSymbols).toHaveBeenCalledTimes(2);
    expect(lazy.defs).toEqual(eager.defs);
    expect(lazy.uses).toEqual(eager.uses);

    const next = snapshot(sources, 2);
    const nextLazy = lazyLegacyIndex(next);
    expect(nextLazy === lazy).toBe(false);
    expect(indexFromSymbols).toHaveBeenCalledTimes(2);
    expect(nextLazy.defs).toEqual(defs);
    expect(indexFromSymbols).toHaveBeenCalledTimes(3);
  });

  it("maps definitions, anchors, includes, and file nodes like the eager index", () => {
    const index = lazyLegacyIndex(snapshot(sources));
    const kinds = new Map(index.defs.map((symbol) => [`${symbol.kind}:${symbol.name}`, symbol]));
    expect(kinds.get("label:sec:intro")?.file).toBe("main.tex");
    expect(kinds.get("label:heading")?.file).toBe("notes.md");
    expect(kinds.get("bibentry:alpha")?.file).toBe("refs.bib");
    expect(kinds.get("macro:vec")?.file).toBe("chapter.tex");
    expect(
      index.defs.filter((symbol) => symbol.kind === "file").map((symbol) => symbol.name),
    ).toEqual(["chapter.tex", "main.tex", "notes.md", "refs.bib"]);
    const include = index.uses.find((symbol) => symbol.kind === "inputedge");
    expect(include?.target).toBe("chapter.tex");
    expect(index.definitionFor(include as NonNullable<typeof include>)?.name).toBe(
      "chapter.tex",
    );
    const cite = index.uses.find((symbol) => symbol.kind === "cite");
    expect(index.definitionFor(cite as NonNullable<typeof cite>)?.kind).toBe(
      "bibentry",
    );
    const plan = index.renamePlan(
      kinds.get("label:sec:intro") as NonNullable<ReturnType<typeof kinds.get>>,
      "sec:start",
    );
    expect(plan.edits).toHaveLength(2);
  });

  it("keeps LaTeX and Typst labels apart for lookup and rename", () => {
    const index = lazyLegacyIndex(
      snapshot({
        "paper.tex": String.raw`\label{eq:mae}
See \eqref{eq:mae}.`,
        "paper.typ": "$ x $ <eq:mae>\n= Other <eq:rmse>\nSee @eq:mae.\n",
      }),
    );
    const latexLabel = index.defs.find(
      (symbol) => symbol.kind === "label" && symbol.file === "paper.tex",
    ) as NonNullable<(typeof index.defs)[number]>;
    const plan = index.renamePlan(latexLabel, "eq:new");
    expect(plan.edits.map((edit) => edit.file)).toEqual([
      "paper.tex",
      "paper.tex",
    ]);
    expect(index.renamePlan(latexLabel, "eq:rmse").collision).toBe(false);

    const typstUse = index.uses.find(
      (symbol) => symbol.name === "eq:mae" && symbol.file === "paper.typ",
    ) as NonNullable<(typeof index.uses)[number]>;
    expect(index.definitionFor(typstUse)?.file).toBe("paper.typ");
  });

  it("follows a Markdown file#anchor link into a LaTeX or Typst label", () => {
    const index = lazyLegacyIndex(
      snapshot({
        "paper.tex": String.raw`\section{Results}\label{sec:results} See \ref{sec:results}.
\label{eq:mae}`,
        "paper.typ": "$ x $ <eq:mae>\n",
        "notes.md":
          "See [results](paper.tex#sec:results) and [error](paper.typ#eq:mae).\n",
        "other.md": "# Other\n\nSee [x](#sec:results).\n",
      }),
    );
    const label = (name: string, file: string) =>
      index.defs.find(
        (symbol) =>
          symbol.kind === "label" && symbol.name === name && symbol.file === file,
      ) as NonNullable<(typeof index.defs)[number]>;
    const link = (name: string) =>
      index.uses.find(
        (symbol) => symbol.name === name && symbol.file === "notes.md",
      ) as NonNullable<(typeof index.uses)[number]>;

    const results = label("sec:results", "paper.tex");
    expect(index.definitionFor(link("sec:results"))).toBe(results);
    // The local link in other.md points at other.md, not at paper.tex.
    expect(index.renamePlan(results, "sec:new").edits.map((edit) => edit.file)).toEqual([
      "notes.md",
      "paper.tex",
      "paper.tex",
    ]);
    expect(index.allReferences(results).map((symbol) => symbol.file)).toContain(
      "notes.md",
    );

    const typstLabel = label("eq:mae", "paper.typ");
    expect(index.definitionFor(link("eq:mae"))).toBe(typstLabel);
    expect(
      index.renamePlan(typstLabel, "eq:new").edits.map((edit) => edit.file),
    ).toEqual(["notes.md", "paper.typ"]);
    expect(
      index
        .renamePlan(label("eq:mae", "paper.tex"), "eq:new")
        .edits.map((edit) => edit.file),
    ).toEqual(["paper.tex"]);
  });
});
