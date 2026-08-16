import { describe, expect, it, beforeEach } from "vitest";
import { currentProjectSourcePaths } from "./project-index";
import { useFilesStore } from "./files";

function seedTree(paths: Array<{ path: string; is_dir?: boolean }>) {
  useFilesStore.setState({
    tree: paths.map((p) => ({ path: p.path, is_dir: p.is_dir ?? false })),
  });
}

describe("currentProjectSourcePaths", () => {
  beforeEach(() => {
    seedTree([]);
  });

  it("returns indexable sources in a stable order regardless of tree order", () => {
    seedTree([
      { path: "zeta.tex" },
      { path: "alpha.tex" },
      { path: "Beta.tex" },
      { path: "mid.tex" },
    ]);
    const first = currentProjectSourcePaths();
    seedTree([
      { path: "mid.tex" },
      { path: "Beta.tex" },
      { path: "zeta.tex" },
      { path: "alpha.tex" },
    ]);
    expect(currentProjectSourcePaths()).toEqual(first);
  });

  it("orders by code point, so uppercase sorts before lowercase", () => {
    seedTree([{ path: "alpha.tex" }, { path: "Beta.tex" }]);
    expect(currentProjectSourcePaths()).toEqual(["Beta.tex", "alpha.tex"]);
  });

  it("skips directories and non-indexable files", () => {
    seedTree([
      { path: "src", is_dir: true },
      { path: "main.tex" },
      { path: "figure.png" },
    ]);
    expect(currentProjectSourcePaths()).toEqual(["main.tex"]);
  });

  it("folds an extra path in without duplicating one already in the tree", () => {
    seedTree([{ path: "main.tex" }]);
    expect(currentProjectSourcePaths("main.tex")).toEqual(["main.tex"]);
    expect(currentProjectSourcePaths("extra.tex")).toEqual([
      "extra.tex",
      "main.tex",
    ]);
  });
});
