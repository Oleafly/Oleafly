import { describe, expect, it } from "vitest";
import type { ProjectIndex, Sym } from "@/lib/index/types";
import { documentSourcePaths } from "./document-sources";

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
