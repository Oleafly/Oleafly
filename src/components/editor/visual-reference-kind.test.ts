import { describe, expect, it } from "vitest";
import type { ProjectIndex, Sym } from "@/lib/index/types";
import { referenceKindIn } from "./visual-reference-kind";

function sym(kind: Sym["kind"], name: string): Sym {
  return { kind, name, file: "main.typ", line: 1, from: 0, to: 0, nameFrom: 0, nameTo: 0 };
}

function index(defs: Sym[]): ProjectIndex {
  return { defs, uses: [] } as unknown as ProjectIndex;
}

describe("referenceKindIn", () => {
  it("tells labels from bibliography keys", () => {
    const project = index([sym("label", "fig-plot"), sym("bibentry", "knuth1984"), sym("section", "Intro")]);
    expect(referenceKindIn(project, "fig-plot")).toBe("label");
    expect(referenceKindIn(project, "knuth1984")).toBe("citation");
    expect(referenceKindIn(project, "missing")).toBeNull();
  });

  it("prefers a label when a key is both", () => {
    expect(referenceKindIn(index([sym("bibentry", "x"), sym("label", "x")]), "x")).toBe("label");
  });

  it("answers nothing without an index", () => {
    expect(referenceKindIn(null, "x")).toBeNull();
  });
});
