import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { mergeLanguageServiceIntelligence } from "@/lib/project-intelligence/merge-language-service";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";

const identity = {
  projectId: "project",
  projectRevision: 1,
  requestGeneration: 1,
};

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
    identity,
    files,
    knownFiles: Object.keys(sources),
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

describe("structure panel duplication", () => {
  it("lists a bibliography target once, not also as a root", () => {
    const value = snapshot({
      "main.tex": String.raw`\documentclass{article}
\begin{document}
\section{Background}
\bibliography{references}
\end{document}`,
      "references.bib": "@book{hastie2009, title={Elements}}",
    });
    expect(value.hierarchy.roots).toEqual(["main.tex"]);
    expect(value.hierarchy.roots).not.toContain("references.bib");
  });

  it("does not list a heading twice when a language server reports it too", () => {
    // The section needs a body: the local node's range spans the heading AND
    // its content, which is exactly what makes it differ from what a language
    // server reports.
    const base = snapshot({
      "main.tex": String.raw`\section{Background}
Prior work is summarised here, at some length, so that the local
outline node spans considerably more than the command itself.`,
    });
    const local = base.outlines["main.tex"] ?? [];
    const section = local.find((node) => node.kind === "section");
    expect(section, "fixture must produce a local section").toBeDefined();
    if (!section) return;

    // A language server reports its own span for the same heading - here the
    // title alone rather than the whole command. Any difference in the end
    // offset used to defeat the duplicate check.
    const merged = mergeLanguageServiceIntelligence(base, {
      identity,
      definitions: [
        {
          id: "texlab:section:Background",
          kind: "section",
          name: section.title,
          source: "texlab",
          engine: "latex",
          level: section.level,
          location: {
            file: "main.tex",
            range: {
              ...section.range,
              to: section.range.from + 9,
            },
          },
        },
      ],
      uses: [],
      diagnostics: [],
    } as never);

    const titles = (merged.outlines["main.tex"] ?? [])
      .filter((node) => node.kind === "section")
      .map((node) => node.title);
    expect(titles).toEqual([section.title]);
  });
});
