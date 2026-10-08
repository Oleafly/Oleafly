import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageCatalog } from "@oleafly/latex-intelligence";

const corpus = vi.hoisted(() => ({
  deps: new Map<string, string[]>(),
  missing: new Set<string>(),
  loads: [] as string[],
}));

vi.mock("@oleafly/latex-intelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/latex-intelligence")>()),
  loadPackageCatalog: vi.fn(async (name: string) => {
    corpus.loads.push(name);
    if (corpus.missing.has(name)) return null;
    return { name, deps: corpus.deps.get(name) ?? [] } as unknown as PackageCatalog;
  }),
}));

type Corpus = typeof import("./latex-corpus");

let module: Corpus;

const names = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function request(list: readonly string[]) {
  module.requestPackageCatalogs(list);
  await settle();
  await settle();
}

const loaded = (list: readonly string[]) => [...module.loadedCatalogsFor(list).keys()];

beforeEach(async () => {
  corpus.deps.clear();
  corpus.missing.clear();
  corpus.loads = [];
  vi.resetModules();
  module = await import("./latex-corpus");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("package catalog requests", () => {
  it("keeps loading packages for projects opened after earlier ones used up the cap", async () => {
    await request(names("first", 30));
    await request(names("second", 30));
    await request(names("third", 30));

    await request(["siunitx"]);

    expect(loaded(["siunitx"])).toEqual(["siunitx"]);
    expect(loaded(names("third", 30))).toHaveLength(30);
  });

  it("loads each package once while a document keeps asking for it", async () => {
    const wanted = names("pkg", 20);
    for (let pass = 0; pass < 10; pass++) await request(wanted);

    expect(corpus.loads).toHaveLength(20);
    expect(loaded(wanted)).toHaveLength(20);
  });

  it("does not ask again for a package the corpus does not have", async () => {
    corpus.missing.add("homemade");
    for (let pass = 0; pass < 5; pass++) await request(["homemade"]);

    expect(corpus.loads).toEqual(["homemade"]);
    expect(loaded(["homemade"])).toEqual([]);
  });

  it("loads the dependencies of each package", async () => {
    corpus.deps.set("tikz", ["pgf", "xcolor"]);

    await request(["tikz"]);

    expect(new Set(loaded(["tikz"]))).toEqual(new Set(["tikz", "pgf", "xcolor"]));
  });

  it("limits one document to the cap, packages before their dependencies", async () => {
    const roots = names("root", 70);
    for (const root of roots) corpus.deps.set(root, [`${root}-dep`]);

    await request(roots);

    expect(corpus.loads).toHaveLength(64);
    expect(corpus.loads.slice(0, 64)).toEqual(roots.slice(0, 64));
  });

  it("notes a capped document once, not on every request", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const crowded = names("crowded", 70);

    await request(crowded);
    await request(crowded);
    await request(names("other", 70));
    await request(names("small", 5));

    expect(debug).toHaveBeenCalledTimes(2);
  });

  it("switches between two projects without loading their packages again", async () => {
    const first = names("a", 50);
    const second = names("b", 50);
    for (let pass = 0; pass < 5; pass++) {
      await request(first);
      await request(second);
    }

    expect(corpus.loads).toHaveLength(100);
  });

  it("keeps a bounded number of catalogs over a long session", async () => {
    const everything: string[] = [];
    for (let project = 0; project < 10; project++) {
      const list = names(`p${project}-`, 40);
      everything.push(...list);
      await request(list);
    }

    expect(loaded(everything).length).toBeLessThanOrEqual(128);
    expect(loaded(names("p9-", 40))).toHaveLength(40);
  });
});
