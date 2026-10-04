import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageCatalog } from "./types";

type IndexModule = typeof import("./index");

const CORE = { commands: [{ name: "section", snippet: "\\section{${1}}" }], environments: [{ name: "itemize" }] };
const NAMES = { names: ["amsmath", "graphicx"], details: { amsmath: "AMS math" } };
const AT = [{ trigger: "@a", replacement: "\\alpha", detail: "alpha" }];

function catalog(deps: string[] = [], macroName = "cmd"): PackageCatalog {
  return { deps, macros: [{ name: macroName }], envs: [], keys: {}, args: [] };
}

async function freshModule(): Promise<IndexModule> {
  vi.resetModules();
  return import("./index");
}

let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("default fetch transport", () => {
  it("fetches from the document origin and returns the parsed body", async () => {
    vi.stubGlobal("location", { origin: "https://app.example", href: "https://app.example/editor" });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CORE }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    await expect(mod.loadCore()).resolves.toEqual(CORE);
    expect(fetchMock).toHaveBeenCalledWith("https://app.example/latex-intelligence/core.json");
  });

  it("falls back to the current href when the origin is opaque", async () => {
    vi.stubGlobal("location", { origin: "null", href: "https://worker.example/sub/worker.js" });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => NAMES }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    await expect(mod.loadPackageNames()).resolves.toEqual(NAMES);
    expect(fetchMock).toHaveBeenCalledWith("https://worker.example/sub/latex-intelligence/package-names.json");
  });

  it("uses a fixed localhost base when there is no location at all", async () => {
    vi.stubGlobal("location", undefined);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => NAMES }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    await mod.loadClassNames();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/latex-intelligence/class-names.json");
  });

  it("uses a root-relative path when the href cannot be parsed as a URL", async () => {
    vi.stubGlobal("location", { origin: "null", href: "not a url" });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => AT }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    await expect(mod.loadAtSuggestions()).resolves.toEqual(AT);
    expect(fetchMock).toHaveBeenCalledWith("/latex-intelligence/at-suggestions.json");
  });

  it("resolves null for a non-ok response without reading the body", async () => {
    vi.stubGlobal("location", { origin: "https://app.example", href: "https://app.example/" });
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json })));
    const mod = await freshModule();

    await expect(mod.loadCore()).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it("resolves null when the body is not JSON, such as an index.html fallback", async () => {
    vi.stubGlobal("location", { origin: "https://app.example", href: "https://app.example/" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token <")) })),
    );
    const mod = await freshModule();

    await expect(mod.loadPackageCatalog("amsmath")).resolves.toBeNull();
  });

  it("is restored by setCorpusTransport(null) after an override", async () => {
    vi.stubGlobal("location", { origin: "https://app.example", href: "https://app.example/" });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => catalog() }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();
    const custom = vi.fn(async () => catalog());

    mod.setCorpusTransport(custom);
    await mod.loadPackageCatalog("first");
    mod.setCorpusTransport(null);
    await mod.loadPackageCatalog("second");

    expect(custom).toHaveBeenCalledTimes(1);
    expect(custom).toHaveBeenCalledWith("packages/first.json");
    expect(fetchMock).toHaveBeenCalledWith("https://app.example/latex-intelligence/packages/second.json");
  });
});

describe.each([
  { loader: "loadCore", path: "core.json", valid: CORE, invalid: { commands: "nope", environments: [] } },
  { loader: "loadAtSuggestions", path: "at-suggestions.json", valid: AT, invalid: [{ trigger: "@a" }] },
  { loader: "loadPackageNames", path: "package-names.json", valid: NAMES, invalid: { names: [1], details: {} } },
  { loader: "loadClassNames", path: "class-names.json", valid: NAMES, invalid: { names: [], details: { a: 1 } } },
] as const)("$loader", ({ loader, path, valid, invalid }) => {
  it("requests its document and resolves the validated payload, once", async () => {
    const mod = await freshModule();
    const transport = vi.fn(async () => valid);
    mod.setCorpusTransport(transport);

    const first = mod[loader]();
    const second = mod[loader]();

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(valid);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(path);
  });

  it("resolves null for a payload of the wrong shape", async () => {
    const mod = await freshModule();
    mod.setCorpusTransport(async () => invalid);

    await expect(mod[loader]()).resolves.toBeNull();
  });

  it("resolves null and logs when the transport rejects", async () => {
    const mod = await freshModule();
    mod.setCorpusTransport(async () => {
      throw new Error("offline");
    });

    await expect(mod[loader]()).resolves.toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("[latex-intelligence]"), expect.any(Error));
  });

  it("resolves null when the transport throws synchronously", async () => {
    const mod = await freshModule();
    mod.setCorpusTransport(() => {
      throw new Error("sync failure");
    });

    await expect(mod[loader]()).resolves.toBeNull();
  });
});

describe("loadPackageCatalog", () => {
  it("rejects names outside the generated basename alphabet without calling the transport", async () => {
    const mod = await freshModule();
    const transport = vi.fn(async () => catalog());
    mod.setCorpusTransport(transport);

    await expect(mod.loadPackageCatalog("")).resolves.toBeNull();
    await expect(mod.loadPackageCatalog("a/b")).resolves.toBeNull();
    await expect(mod.loadPackageCatalog("name.json")).resolves.toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it("accepts class catalogs and the punctuation CTAN names use", async () => {
    const mod = await freshModule();
    const transport = vi.fn(async (_path: string) => catalog());
    mod.setCorpusTransport(transport);

    await expect(mod.loadPackageCatalog("class-article")).resolves.toEqual(catalog());
    await expect(mod.loadPackageCatalog("l3_back+end@x")).resolves.toEqual(catalog());
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      "packages/class-article.json",
      "packages/l3_back+end@x.json",
    ]);
  });

  it("caches successes and failures by name", async () => {
    const mod = await freshModule();
    const transport = vi.fn(async (path: string) => (path.includes("good") ? catalog() : { deps: "bad" }));
    mod.setCorpusTransport(transport);

    const good = mod.loadPackageCatalog("good");
    expect(mod.loadPackageCatalog("good")).toBe(good);
    await expect(good).resolves.toEqual(catalog());
    await expect(mod.loadPackageCatalog("broken")).resolves.toBeNull();
    await expect(mod.loadPackageCatalog("broken")).resolves.toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("logs the package name when a load fails", async () => {
    const mod = await freshModule();
    mod.setCorpusTransport(async () => {
      throw new Error("disk gone");
    });

    await expect(mod.loadPackageCatalog("siunitx")).resolves.toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('"siunitx"'),
      expect.objectContaining({ message: "disk gone" }),
    );
  });

  it("evicts the least recently used catalog beyond 32 entries", async () => {
    const mod = await freshModule();
    const transport = vi.fn(async () => catalog());
    mod.setCorpusTransport(transport);

    for (let index = 0; index < 32; index += 1) {
      await mod.loadPackageCatalog(`pkg${index}`);
    }
    await mod.loadPackageCatalog("pkg0");
    await mod.loadPackageCatalog("pkg32");
    expect(transport).toHaveBeenCalledTimes(33);

    await mod.loadPackageCatalog("pkg0");
    expect(transport).toHaveBeenCalledTimes(33);

    await mod.loadPackageCatalog("pkg1");
    expect(transport).toHaveBeenCalledTimes(34);
    expect(transport).toHaveBeenLastCalledWith("packages/pkg1.json");
  });
});

describe("resolvePackageClosure", () => {
  it("loads the requested names plus one level of their dependencies", async () => {
    const { resolvePackageClosure } = await freshModule();
    const graph: Record<string, PackageCatalog> = {
      tikz: catalog(["pgf", "xcolor"]),
      pgf: catalog(["pgfcore"]),
      xcolor: catalog(),
      pgfcore: catalog(),
    };
    const lookup = vi.fn(async (name: string) => graph[name] ?? null);

    const resolved = await resolvePackageClosure(["tikz"], lookup);

    expect([...resolved.keys()]).toEqual(["tikz", "pgf", "xcolor"]);
    expect(lookup).not.toHaveBeenCalledWith("pgfcore");
  });

  it("skips repeated names, shared dependencies and catalogs that fail to load", async () => {
    const { resolvePackageClosure } = await freshModule();
    const graph: Record<string, PackageCatalog> = {
      a: catalog(["shared", "missing"]),
      b: catalog(["shared", "a"]),
      shared: catalog(),
    };
    const lookup = vi.fn(async (name: string) => graph[name] ?? null);

    const resolved = await resolvePackageClosure(["a", "a", "b", "ghost"], lookup);

    expect([...resolved.keys()]).toEqual(["a", "b", "shared"]);
    expect(lookup.mock.calls.map(([name]) => name)).toEqual(["a", "b", "ghost", "shared", "missing"]);
  });

  it("stops loading direct names once the cap is reached", async () => {
    const { resolvePackageClosure } = await freshModule();
    const lookup = vi.fn(async () => catalog(["dep"]));

    const resolved = await resolvePackageClosure(["one", "two", "three"], lookup, 2);

    expect([...resolved.keys()]).toEqual(["one", "two"]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("stops loading dependencies once the cap is reached", async () => {
    const { resolvePackageClosure } = await freshModule();
    const graph: Record<string, PackageCatalog> = {
      root: catalog(["d1", "d2", "d3"]),
      d1: catalog(),
      d2: catalog(),
      d3: catalog(),
    };
    const lookup = vi.fn(async (name: string) => graph[name] ?? null);

    const resolved = await resolvePackageClosure(["root"], lookup, 3);

    expect([...resolved.keys()]).toEqual(["root", "d1", "d2"]);
    expect(lookup).not.toHaveBeenCalledWith("d3");
  });

  it("returns an empty map for no names", async () => {
    const { resolvePackageClosure } = await freshModule();
    const lookup = vi.fn();

    await expect(resolvePackageClosure([], lookup)).resolves.toEqual(new Map());
    expect(lookup).not.toHaveBeenCalled();
  });
});
