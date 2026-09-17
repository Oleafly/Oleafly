// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DictionaryLoadError,
  isBundledDictionaryLocale,
  loadHunspellDictionary,
  normalizeDictionaryLocaleId,
} from "./hunspell";

const mocks = vi.hoisted(() => ({
  mounted: [] as string[],
  created: [] as string[],
  fetched: [] as string[],
  fetchOk: true,
}));

vi.mock("hunspell-asm", () => ({
  loadModule: async () => ({
    mountBuffer: (_bytes: Uint8Array, name?: string) => {
      mocks.mounted.push(name ?? "");
      return `/${name ?? ""}`;
    },
    create: (affPath: string) => {
      mocks.created.push(affPath);
      return { spell: () => true, suggest: () => [], dispose: () => {} };
    },
  }),
}));

async function reason(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof DictionaryLoadError ? error.reason : "unexpected";
  }
  return "resolved";
}

beforeEach(() => {
  mocks.mounted.length = 0;
  mocks.created.length = 0;
  mocks.fetched.length = 0;
  mocks.fetchOk = true;
  vi.stubGlobal("fetch", async (input: URL | string) => {
    mocks.fetched.push(String(input));
    return {
      ok: mocks.fetchOk,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response;
  });
});

describe("dictionary locale identifiers", () => {
  it("accepts the hyphenated spelling users paste", () => {
    expect(normalizeDictionaryLocaleId("pt-BR")).toBe("pt_BR");
    expect(normalizeDictionaryLocaleId("  es_ES ")).toBe("es_ES");
  });

  it("knows exactly which packs ship inside the app", () => {
    expect(isBundledDictionaryLocale("en_US")).toBe(true);
    expect(isBundledDictionaryLocale("fr-FR")).toBe(true);
    expect(isBundledDictionaryLocale("es_ES")).toBe(false);
  });
});

describe("loading a Hunspell pack", () => {
  it("refuses an identifier that could address anything else", async () => {
    expect(await reason(loadHunspellDictionary("../en_US"))).toBe("unavailable");
    expect(await reason(loadHunspellDictionary("en_US/../.."))).toBe(
      "unavailable",
    );
    expect(mocks.fetched).toHaveLength(0);
  });

  it("separates a language it does not carry from one that failed to load", async () => {
    expect(await reason(loadHunspellDictionary("es_ES"))).toBe("not_installed");
    expect(mocks.fetched).toHaveLength(0);

    mocks.fetchOk = false;
    expect(
      await reason(
        loadHunspellDictionary("en_GB", { baseUrl: "http://localhost/" }),
      ),
    ).toBe("load_failed");
    expect(mocks.fetched).toHaveLength(2);
  });

  it("loads a shipped pack from the packaged assets", async () => {
    await loadHunspellDictionary("en_US", { baseUrl: "http://localhost/" });

    expect(mocks.fetched).toEqual([
      "http://localhost/dictionaries/en_US.aff",
      "http://localhost/dictionaries/en_US.dic",
    ]);
    expect(mocks.mounted).toEqual(["en_US.aff", "en_US.dic"]);
    expect(mocks.created).toEqual(["/en_US.aff"]);
  });

  it("loads a downloaded pack from delivered bytes without any fetch", async () => {
    await loadHunspellDictionary("es_ES", {
      payload: {
        aff: new Uint8Array([1]),
        dic: new Uint8Array([2, 3]),
      },
    });

    expect(mocks.fetched).toHaveLength(0);
    expect(mocks.mounted).toEqual(["es_ES.aff", "es_ES.dic"]);
    expect(mocks.created).toEqual(["/es_ES.aff"]);
  });

  it("rejects an empty payload instead of creating a dictionary that finds nothing", async () => {
    expect(
      await reason(
        loadHunspellDictionary("es_ES", {
          payload: { aff: new Uint8Array(), dic: new Uint8Array([1]) },
        }),
      ),
    ).toBe("load_failed");
    expect(mocks.created).toHaveLength(0);
  });
});
