import { describe, expect, it, vi } from "vitest";
import type { ProjectIndex, Sym } from "@/lib/index/types";
import { documentSourcePaths, readDocumentSources } from "./document-sources";

const readProjectSources = vi.hoisted(() => vi.fn());
vi.mock("@/store/project-index", () => ({ readProjectSources }));

function edge(file: string, target: string, from: number): Sym {
  return {
    kind: "inputedge",
    name: target,
    file,
    line: 1,
    from,
    to: from + 1,
    nameFrom: from,
    nameTo: from + 1,
    target,
  };
}

function indexWithUses(uses: Sym[]): ProjectIndex {
  return { uses } as unknown as ProjectIndex;
}

describe("documentSourcePaths", () => {
  it("walks includes in reading order but never into the vendored Typst packages", () => {
    const index = indexWithUses([
      edge("main.typ", "typst-packages/preview/cetz/0.5.2/lib.typ", 0),
      edge("main.typ", "sections/intro.typ", 10),
      edge("sections/intro.typ", "chapters/typst-packages/notes.typ", 0),
      edge("typst-packages/preview/cetz/0.5.2/lib.typ", "typst-packages/preview/cetz/0.5.2/draw.typ", 0),
    ]);
    expect(documentSourcePaths(index, "main.typ")).toEqual([
      "main.typ",
      "sections/intro.typ",
      "chapters/typst-packages/notes.typ",
    ]);
  });
});


describe("documentSourcePaths limits", () => {
  it("returns only the root without an index", () => {
    expect(documentSourcePaths(null, "main.tex")).toEqual(["main.tex"]);
  });

  it("stops at include cycles and at the depth limit, and falls back to the raw name", () => {
    const chain = Array.from({ length: 12 }, (_, depth) => edge(`d${depth}.tex`, `d${depth + 1}.tex`, 0));
    const cycle = [edge("main.tex", "a.tex", 0), edge("a.tex", "main.tex", 0), { ...edge("a.tex", "b.tex", 5), target: undefined }];
    expect(documentSourcePaths(indexWithUses(cycle), "main.tex")).toEqual(["main.tex", "a.tex", "b.tex"]);
    expect(documentSourcePaths(indexWithUses(chain), "d0.tex")).toEqual(
      Array.from({ length: 9 }, (_, depth) => `d${depth}.tex`),
    );
  });
});

describe("readDocumentSources", () => {
  it("returns the readable sources in reading order and lists the unreadable ones", async () => {
    readProjectSources.mockResolvedValue({
      texts: { "main.tex": "\\input{a}", "b.tex": "B" },
      unreadable: new Set(["a.tex"]),
    });
    const index = indexWithUses([edge("main.tex", "a.tex", 0), edge("main.tex", "b.tex", 5)]);
    await expect(readDocumentSources("p1", index, "main.tex")).resolves.toEqual({
      paths: ["main.tex", "b.tex"],
      texts: ["\\input{a}", "B"],
      unreadable: ["a.tex"],
    });
    expect(readProjectSources).toHaveBeenCalledWith("p1", ["main.tex", "a.tex", "b.tex"]);
  });
});
