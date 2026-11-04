import { describe, expect, it } from "vitest";
import { buildProjectContext, buildRefsContext, type PreflightContextInput } from "./preflight-context";
import { analyzeProjectFile } from "./project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "./project-intelligence/assemble";
import { legacyIndexFromProjectIntelligence } from "./project-intelligence/legacy-index";

function input(
  indexTexts: Record<string, string>,
  over: Partial<PreflightContextInput> = {},
): PreflightContextInput {
  return {
    mainDoc: "main.tex",
    treePaths: Object.keys(indexTexts),
    indexTexts,
    openTexts: {},
    index: null,
    ...over,
  };
}

describe("buildRefsContext", () => {
  it("marks the bibliography loaded only when every declared file resolves", () => {
    expect(
      buildRefsContext(input({ "main.tex": "\\bibliography{refs}", "refs.bib": "@misc{a,}" })).bibLoaded,
    ).toBe(true);
    expect(buildRefsContext(input({ "main.tex": "\\bibliography{missing}" })).bibLoaded).toBe(false);
    expect(buildRefsContext(input({ "main.tex": "Text", "refs.bib": "" })).bibLoaded).toBe(true);
  });

  it("ignores a conflict copy that the document does not load", () => {
    const refs = buildRefsContext(
      input({
        "main.tex": "\\bibliography{refs}",
        "refs.bib": "@misc{kept,}",
        "refs (conflict).bib": "@misc{copied,}",
      }),
    );
    expect(refs.bibKeyDefinitions?.map((definition) => definition.key)).toEqual(["kept"]);
    expect(refs.bibEntries?.map((entry) => entry.key)).toEqual(["kept"]);
  });

  it("uses the biber dialect for addbibresource", () => {
    const refs = buildRefsContext(input({ "main.tex": "\\addbibresource{refs.bib}", "refs.bib": "" }));
    expect(refs.bibKeyDialect).toBe("biber");
  });

  it("counts an unsaved editor buffer as a known path", () => {
    const refs = buildRefsContext(
      input({ "main.tex": "\\bibliography{new}" }, { openTexts: { "new.bib": "@misc{n,}" } }),
    );
    expect(refs.bibLoaded).toBe(true);
    expect(refs.unresolvedBibliographies).toEqual([]);
    expect(refs.bibKeys).toContain("n");
  });

  it("collects cited keys and duplicate DOIs from the loaded files", () => {
    const refs = buildRefsContext(
      input({
        "main.tex": "\\cite{a, b}\n% \\cite{hidden}",
        "refs.bib": "@misc{a, doi = {10.1/X}}\n@misc{b, doi = {https://doi.org/10.1/x}}",
      }),
    );
    expect(refs.allCitedKeys).toEqual(["a", "b"]);
    expect(refs.duplicateDois).toEqual([{ doi: "10.1/x", keys: ["a", "b"] }]);
  });

  it("reports label facts for the main document's compilation unit", () => {
    const texts = {
      "main.tex": String.raw`\documentclass{article}
\input{shared}
\label{sec:shared}`,
      "main_v1.tex": String.raw`\documentclass{article}
\input{shared}
\label{sec:shared}
\label{fig:old}
\ref{fig:x}`,
      "shared.tex": String.raw`\label{sec:shared}\label{fig:x}`,
    };
    const files = Object.fromEntries(
      Object.entries(texts).map(([file, text]) => [file, analyzeProjectFile(file, text, 1)]),
    );
    const snapshot = assembleProjectIntelligence({
      identity: { projectId: "refs", projectRevision: 1, requestGeneration: 1 },
      files,
      knownFiles: Object.keys(texts),
      mainDocument: "main.tex",
      stats: { fileCount: 3, characterCount: 0, parsedFileCount: 3, reusedFileCount: 0, durationMs: 0 },
    });
    const refs = buildRefsContext(input(texts, { index: legacyIndexFromProjectIntelligence(snapshot) }));

    expect(refs.duplicateLabels).toEqual([{ label: "sec:shared", files: ["main.tex", "shared.tex"] }]);
    expect(refs.unreferencedLabels).toEqual([{ label: "fig:x", file: "shared.tex" }]);
  });
});

describe("buildProjectContext", () => {
  it("lists tree paths and open buffers, with content where a text exists", () => {
    const project = buildProjectContext({
      mainDoc: "main.tex",
      treePaths: ["main.tex", "figure.png"],
      indexTexts: { "main.tex": "saved" },
      openTexts: { "main.tex": "edited", "draft.tex": "new" },
    });
    expect(project).toEqual({
      mainFile: "main.tex",
      files: [
        { path: "main.tex", content: "edited" },
        { path: "figure.png" },
        { path: "draft.tex", content: "new" },
      ],
    });
  });
});
