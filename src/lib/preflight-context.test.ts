import { describe, expect, it } from "vitest";
import { buildProjectContext, buildRefsContext, type PreflightContextInput } from "./preflight-context";

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
