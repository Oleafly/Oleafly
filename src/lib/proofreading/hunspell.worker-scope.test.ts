// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHunspellDictionary } from "./hunspell";

const mocks = vi.hoisted(() => ({ fetched: [] as string[] }));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => `/${name ?? ""}`,
    create: () => ({ spell: () => true, suggest: () => [], dispose: () => {} }),
  }),
}));

type ScriptLoader = { importScripts?: (...urls: string[]) => void };

beforeEach(() => {
  mocks.fetched.length = 0;
  vi.stubGlobal("fetch", async (input: URL | string) => {
    mocks.fetched.push(String(input));
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as ScriptLoader).importScripts;
});

describe("loading a dictionary inside a module worker", () => {
  it("fetches from localhost when the worker has no location", async () => {
    await loadHunspellDictionary("en_US");

    expect(mocks.fetched).toEqual([
      "http://localhost/dictionaries/en_US.aff",
      "http://localhost/dictionaries/en_US.dic",
    ]);
  });

  it("disables classic script loading before Hunspell starts", async () => {
    await loadHunspellDictionary("en_GB");

    const loader = (globalThis as ScriptLoader).importScripts;
    expect(typeof loader).toBe("function");
    expect(() => loader?.("https://example.com/x.js")).toThrow(
      "Dynamic script loading is disabled in the proofreading worker.",
    );
  });

  it("keeps a script loader the worker already has", async () => {
    const existing = vi.fn();
    (globalThis as ScriptLoader).importScripts = existing;

    await loadHunspellDictionary("en_AU");

    expect((globalThis as ScriptLoader).importScripts).toBe(existing);
  });

  it("resolves packs against the page address when the origin is opaque", async () => {
    vi.stubGlobal("location", { origin: "null", href: "file:///Applications/Oleafly/index.html" });

    await loadHunspellDictionary("de_DE");

    expect(mocks.fetched).toEqual([
      "file:///Applications/Oleafly/dictionaries/de_DE.aff",
      "file:///Applications/Oleafly/dictionaries/de_DE.dic",
    ]);
  });

  it("falls back to localhost when the location has no address", async () => {
    vi.stubGlobal("location", { origin: "null" });

    await loadHunspellDictionary("fr_FR");

    expect(mocks.fetched[0]).toBe("http://localhost/dictionaries/fr_FR.aff");
  });
});
