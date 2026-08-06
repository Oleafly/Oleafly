import { beforeAll, describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import { astAugmentLatexFile, latexAstReady } from "./latex-ast";
import { lineStarts } from "./source";
import type { ProjectIntelligenceSnapshot } from "./types";

// The AST parser loads lazily in production; tests wait for it so the
// augmentation path is exercised deterministically.
beforeAll(async () => {
  await latexAstReady();
});

function augment(source: string) {
  return astAugmentLatexFile("main.tex", source, lineStarts(source));
}

function snapshot(
  sources: Readonly<Record<string, string>>,
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [
      file,
      analyzeProjectFile(file, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: {
      projectId: "project",
      projectRevision: 1,
      requestGeneration: 1,
    },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: Object.values(sources).reduce(
        (sum, source) => sum + source.length,
        0,
      ),
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

describe("astAugmentLatexFile", () => {
  it("extracts a glossary entry with its name field as detail", () => {
    const result = augment(
      String.raw`\newglossaryentry{key}{name={N}, description={d}}`,
    );
    expect(result).not.toBeNull();
    expect(result?.definitions).toHaveLength(1);
    const definition = result?.definitions[0];
    expect(definition?.kind).toBe("glossary");
    expect(definition?.name).toBe("key");
    expect(definition?.detail).toBe("N");
    expect(definition?.location.file).toBe("main.tex");
  });

  it("extracts an acronym with short and long forms in the detail", () => {
    const result = augment(
      String.raw`\newacronym{ast}{AST}{Abstract Syntax Tree}`,
    );
    const definition = result?.definitions[0];
    expect(definition?.kind).toBe("glossary");
    expect(definition?.name).toBe("ast");
    expect(definition?.detail).toBe("AST, Abstract Syntax Tree");
  });

  it("skips a leading optional argument on \\newacronym", () => {
    const result = augment(
      String.raw`\newacronym[longplural={frames per second}]{k}{S}{L}`,
    );
    const definition = result?.definitions[0];
    expect(definition?.name).toBe("k");
    expect(definition?.detail).toBe("S, L");
  });

  it("returns null when the source has no glossary macros", () => {
    expect(
      augment(String.raw`\section{Intro} \gls{key} plain text`),
    ).toBeNull();
  });

  it("returns null for oversized sources", () => {
    const source =
      String.raw`\newglossaryentry{key}{name={N}}` + "x".repeat(1_000_001);
    expect(augment(source)).toBeNull();
  });

  it("returns null instead of throwing on unparsable garbage", () => {
    const source = `\\newglossaryentry{\\{%\n\\begin{${"}".repeat(3)}`;
    expect(() => augment(source)).not.toThrow();
    expect(augment(source)).toBeNull();
  });
});

describe("analyzeProjectFile glossary and package extraction", () => {
  it("captures glossary command uses with kind glossary", () => {
    const file = analyzeProjectFile(
      "main.tex",
      String.raw`\gls{x} and \acrfull{y}`,
      1,
    );
    const glossaryUses = file.uses.filter(
      (use) => use.kind === "glossary",
    );
    expect(glossaryUses.map((use) => use.name).sort()).toEqual(["x", "y"]);
  });

  it("captures each package of a comma-separated \\usepackage list", () => {
    const file = analyzeProjectFile(
      "main.tex",
      String.raw`\usepackage[colorlinks=true]{a,b}`,
      1,
    );
    expect(file.packageRefs).toHaveLength(2);
    expect(
      file.packageRefs?.map((ref) => ({ name: ref.name, kind: ref.kind })),
    ).toEqual([
      { name: "a", kind: "package" },
      { name: "b", kind: "package" },
    ]);
  });

  it("captures \\documentclass as a class reference", () => {
    const file = analyzeProjectFile(
      "main.tex",
      String.raw`\documentclass{article}`,
      1,
    );
    expect(file.packageRefs).toEqual([
      expect.objectContaining({ name: "article", kind: "class" }),
    ]);
  });

  it("counts \\RequirePackage as a package reference", () => {
    const file = analyzeProjectFile(
      "style.sty",
      String.raw`\RequirePackage{hyperref}`,
      1,
    );
    expect(file.packageRefs).toEqual([
      expect.objectContaining({ name: "hyperref", kind: "package" }),
    ]);
  });

  it("does not capture commented-out package loads", () => {
    const file = analyzeProjectFile(
      "main.tex",
      ["\\documentclass{article}", "% \\usepackage{x}"].join("\n"),
      1,
    );
    expect(
      file.packageRefs?.some((ref) => ref.name === "x"),
    ).toBe(false);
  });
});

describe("assembled glossary resolution", () => {
  it("resolves \\gls uses to the AST glossary definition and reports packages", () => {
    const value = snapshot({
      "main.tex": [
        String.raw`\documentclass{article}`,
        String.raw`\usepackage[acronym]{glossaries}`,
        String.raw`\newglossaryentry{tree}{name={Tree}, description={A tree}}`,
        String.raw`\begin{document}`,
        String.raw`\gls{tree}`,
        String.raw`\end{document}`,
      ].join("\n"),
    });

    const definition = value.definitions.find(
      (candidate) =>
        candidate.kind === "glossary" && candidate.name === "tree",
    );
    expect(definition).toBeDefined();
    expect(definition?.detail).toBe("Tree");

    const use = value.uses.find(
      (candidate) =>
        candidate.kind === "glossary" && candidate.name === "tree",
    );
    expect(use).toBeDefined();
    expect(use?.resolution).toBe("resolved");
    expect(use?.definitionIds).toEqual([definition?.id]);

    expect(value.detectedPackages).toContain("glossaries");
    expect(value.documentClasses).toContain("article");
  });
});
