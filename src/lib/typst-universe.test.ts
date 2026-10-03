import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  compareVersions,
  compilerTooNew,
  importEdit,
  importLine,
  loadUniverseIndex,
  outdatedImports,
  packageCategories,
  previewImports,
  resetUniverseIndexCache,
  searchPackages,
  type UniversePackage,
} from "./typst-universe";

function universePackage(overrides: Partial<UniversePackage> & { name: string }): UniversePackage {
  return {
    version: "1.0.0",
    versions: ["1.0.0"],
    description: "",
    authors: [],
    license: null,
    keywords: [],
    categories: [],
    disciplines: [],
    compiler: null,
    template: false,
    updatedAt: null,
    homepage: null,
    ...overrides,
  };
}

const PACKAGES = [
  universePackage({
    name: "cetz",
    version: "0.5.2",
    description: "Drawing with Typst made easy",
    keywords: ["draw", "canvas"],
    categories: ["visualization"],
    compiler: "0.14.0",
  }),
  universePackage({
    name: "cetz-plot",
    version: "0.1.3",
    description: "Plotting for CeTZ",
    keywords: ["plot", "chart"],
    categories: ["visualization"],
  }),
  universePackage({
    name: "tablex",
    version: "0.0.9",
    description: "Tables with more control",
    keywords: ["table"],
    categories: ["layout"],
  }),
  universePackage({
    name: "fletcher",
    version: "0.5.8",
    description: "Draw diagrams with nodes and arrows",
    keywords: ["diagram", "arrow"],
    categories: ["visualization"],
  }),
  universePackage({
    name: "charged-ieee",
    version: "0.1.4",
    description: "An IEEE-style paper template",
    categories: ["paper"],
    template: true,
  }),
];

describe("versions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.4.2", "0.4.2")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });

  it("warns only when a package needs a newer Typst than the project has", () => {
    expect(compilerTooNew(PACKAGES[0], "0.13.1")).toBe(true);
    expect(compilerTooNew(PACKAGES[0], "0.14.0")).toBe(false);
    expect(compilerTooNew(PACKAGES[0], "0.15.1")).toBe(false);
    expect(compilerTooNew(PACKAGES[0], null)).toBe(false);
    expect(compilerTooNew(PACKAGES[1], "0.11.1")).toBe(false);
  });
});

describe("searchPackages", () => {
  it("lists everything by name when the query is empty", () => {
    expect(searchPackages(PACKAGES, "", null).map((p) => p.name)).toEqual([
      "cetz",
      "cetz-plot",
      "charged-ieee",
      "fletcher",
      "tablex",
    ]);
  });

  it("ranks exact names, then name prefixes, then keywords, then descriptions", () => {
    expect(searchPackages(PACKAGES, "cetz", null).map((p) => p.name)).toEqual(["cetz", "cetz-plot"]);
    expect(searchPackages(PACKAGES, "draw", null).map((p) => p.name)).toEqual(["cetz", "fletcher"]);
    expect(searchPackages(PACKAGES, "  TABLE ", null).map((p) => p.name)).toEqual(["tablex"]);
  });

  it("requires every word to match and narrows by category", () => {
    expect(searchPackages(PACKAGES, "draw arrows", null).map((p) => p.name)).toEqual(["fletcher"]);
    expect(searchPackages(PACKAGES, "", "paper").map((p) => p.name)).toEqual(["charged-ieee"]);
    expect(searchPackages(PACKAGES, "plot", "layout")).toEqual([]);
    expect(searchPackages(PACKAGES, "visualization", null)).toHaveLength(3);
  });

  it("collects the categories in use", () => {
    expect(packageCategories(PACKAGES)).toEqual(["layout", "paper", "visualization"]);
  });
});

describe("importEdit", () => {
  it("writes the import line Typst Universe documents", () => {
    expect(importLine("cetz", "0.5.2")).toBe('#import "@preview/cetz:0.5.2": *');
  });

  it("inserts at the top of a file without imports", () => {
    expect(importEdit("= Title\n", "cetz", "0.5.2")).toEqual({
      from: 0,
      to: 0,
      insert: '#import "@preview/cetz:0.5.2": *\n',
    });
  });

  it("inserts after the imports that open the file", () => {
    const text = '// header\n#import "@preview/tablex:0.0.9": tablex\n\n#import "lib.typ": x\n= Title\n#import "late.typ"\n';
    const edit = importEdit(text, "cetz", "0.5.2");
    expect(edit).toEqual({
      from: text.indexOf("= Title"),
      to: text.indexOf("= Title"),
      insert: '#import "@preview/cetz:0.5.2": *\n',
    });
  });

  it("adds a line break when the last import has none", () => {
    const text = '#import "a.typ"';
    expect(importEdit(text, "cetz", "0.5.2")).toEqual({
      from: text.length,
      to: text.length,
      insert: '\n#import "@preview/cetz:0.5.2": *',
    });
  });

  it("updates the version of an existing import instead of adding a second one", () => {
    const text = '#import "@preview/cetz:0.4.2": canvas\n';
    const from = text.indexOf("0.4.2");
    expect(importEdit(text, "cetz", "0.5.2")).toEqual({ from, to: from + 5, insert: "0.5.2" });
    expect(importEdit('#import "@preview/cetz:0.5.2"', "cetz", "0.5.2")).toBeNull();
  });
});

describe("previewImports", () => {
  const text = [
    '#import "@preview/cetz:0.4.2": canvas',
    '// #import "@preview/fletcher:0.1.0"',
    '#import "@local/mine:0.1.0"',
    '#import "@preview/tablex:0.0.9"',
    '/* "@preview/hidden:0.1.0" */',
    '#let s = "@preview/broken"',
  ].join("\n");

  it("finds @preview specs in string literals outside comments", () => {
    expect(previewImports(text)).toEqual([
      { name: "cetz", version: "0.4.2", from: text.indexOf("0.4.2"), to: text.indexOf("0.4.2") + 5 },
      { name: "tablex", version: "0.0.9", from: text.indexOf("0.0.9"), to: text.indexOf("0.0.9") + 5 },
    ]);
  });

  it("reports only imports older than the newest release", () => {
    const latest = new Map([
      ["cetz", "0.5.2"],
      ["tablex", "0.0.9"],
    ]);
    expect(outdatedImports(text, latest)).toEqual([
      {
        name: "cetz",
        version: "0.4.2",
        latest: "0.5.2",
        from: text.indexOf("0.4.2"),
        to: text.indexOf("0.4.2") + 5,
      },
    ]);
    expect(outdatedImports(text, new Map())).toEqual([]);
  });
});

describe("loadUniverseIndex", () => {
  beforeEach(() => {
    invoke.mockReset();
    resetUniverseIndexCache();
  });

  it("asks the backend once and shares the answer", async () => {
    const index = { fetchedAt: 1, stale: false, packages: PACKAGES };
    invoke.mockResolvedValue(index);
    const [first, second] = await Promise.all([
      loadUniverseIndex({ offline: false }),
      loadUniverseIndex({ offline: false }),
    ]);
    expect(first).toBe(index);
    expect(second).toBe(index);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("typst_universe_index", { offline: false, refresh: false });
  });

  it("asks again after an hour", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 1, 8));
      invoke.mockResolvedValue({ fetchedAt: 1, stale: false, packages: [] });
      await loadUniverseIndex({ offline: false });
      vi.setSystemTime(Date.UTC(2026, 9, 1, 8, 59));
      await loadUniverseIndex({ offline: false });
      expect(invoke).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.UTC(2026, 9, 1, 9, 1));
      await loadUniverseIndex({ offline: false });
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes offline and refresh through and forgets failures", async () => {
    invoke.mockRejectedValueOnce(new Error("offline"));
    await expect(loadUniverseIndex({ offline: true })).rejects.toThrow("offline");
    invoke.mockResolvedValueOnce({ fetchedAt: 2, stale: true, packages: [] });
    await loadUniverseIndex({ offline: true, refresh: true });
    expect(invoke).toHaveBeenLastCalledWith("typst_universe_index", { offline: true, refresh: true });
  });
});
