// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryInfo } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  listDictionaries: vi.fn<() => Promise<DictionaryInfo[]>>(),
}));

vi.mock("@/lib/tauri", () => ({
  listDictionaries: mocks.listDictionaries,
}));

import {
  dictionaryLabel,
  dictionaryLanguageName,
  effectiveDictionaryLocale,
  groupDictionariesByLanguage,
  isBundledDictionary,
  isDictionaryLocaleId,
  loadDictionaryCatalog,
  matchesDictionaryQuery,
  normalizeDictionaryLocale,
  refreshDictionaryCatalog,
} from "./dictionary-catalog";

function entry(
  id: string,
  language: string,
  region: string | null,
  state: DictionaryInfo["state"] = "available",
): DictionaryInfo {
  return {
    id,
    language,
    region,
    license: { id: "MIT", url: "https://example.invalid/license" },
    bytes: 1_000,
    state,
  };
}

beforeEach(() => {
  mocks.listDictionaries.mockReset();
});

describe("dictionary identifiers", () => {
  it("accepts catalog shapes and rejects anything else", () => {
    expect(isDictionaryLocaleId("en_US")).toBe(true);
    expect(isDictionaryLocaleId("sr_Latn")).toBe(true);
    expect(isDictionaryLocaleId("eo")).toBe(true);
    expect(isDictionaryLocaleId("pt-BR")).toBe(true);
    expect(isDictionaryLocaleId("../en_US")).toBe(false);
    expect(isDictionaryLocaleId("English")).toBe(false);
    expect(isDictionaryLocaleId("")).toBe(false);
    expect(normalizeDictionaryLocale("pt-BR")).toBe("pt_BR");
    expect(isBundledDictionary("de_DE")).toBe(true);
    expect(isBundledDictionary("de_AT")).toBe(false);
  });
});

describe("dictionary labels", () => {
  it("names a language in the interface language, not the catalog language", () => {
    expect(dictionaryLanguageName(entry("es_ES", "Spanish", "Spain"), "en")).toBe(
      "Spanish",
    );
    expect(
      dictionaryLanguageName(entry("es_ES", "Spanish", "Spain"), "fr"),
    ).toBe("espagnol");
    expect(dictionaryLabel(entry("es_ES", "Spanish", "Spain"), "en")).toBe(
      "Spanish (Spain)",
    );
    expect(dictionaryLabel(entry("eo", "Esperanto", null), "en")).toBe(
      "Esperanto",
    );
    expect(dictionaryLabel(entry("sr_Latn", "Serbian", "Latin"), "en")).toBe(
      "Serbian (Latin)",
    );
  });

  it("falls back to the catalog name for a language the runtime cannot name", () => {
    expect(dictionaryLabel(entry("zzz_QQ", "Testish", "Testland"), "en")).toBe(
      "Testish (Testland)",
    );
  });

  it("groups regional variants under one language heading", () => {
    const groups = groupDictionariesByLanguage(
      [
        entry("pt_PT", "Portuguese", "Portugal"),
        entry("en_US", "English", "United States", "bundled"),
        entry("pt_BR", "Portuguese", "Brazil"),
      ],
      "en",
    );

    expect(groups.map((group) => group.language)).toEqual([
      "English",
      "Portuguese",
    ]);
    expect(groups[1].entries.map((item) => item.id)).toEqual([
      "pt_BR",
      "pt_PT",
    ]);
  });

  it("finds a language by identifier, English name, or localized name", () => {
    const spanish = entry("es_MX", "Spanish", "Mexico");
    expect(matchesDictionaryQuery(spanish, "en", "mex")).toBe(true);
    expect(matchesDictionaryQuery(spanish, "en", "es_MX")).toBe(true);
    expect(matchesDictionaryQuery(spanish, "en", "")).toBe(true);
    expect(matchesDictionaryQuery(spanish, "en", "german")).toBe(false);
  });
});

describe("effective dictionary locale", () => {
  it("prefers the project language over the app setting", () => {
    expect(
      effectiveDictionaryLocale({ project: "fr_FR", global: "en_US" }),
    ).toBe("fr_FR");
    expect(effectiveDictionaryLocale({ project: null, global: "de_DE" })).toBe(
      "de_DE",
    );
    expect(effectiveDictionaryLocale({ project: "pt-BR", global: "en_US" })).toBe(
      "pt_BR",
    );
  });

  it("ignores an unusable value on either side", () => {
    expect(
      effectiveDictionaryLocale({ project: "../fr_FR", global: "en_GB" }),
    ).toBe("en_GB");
    expect(effectiveDictionaryLocale({ project: "", global: "" })).toBe("en_US");
    expect(effectiveDictionaryLocale({})).toBe("en_US");
  });
});

describe("catalog loading", () => {
  it("asks the backend once and serves the cached answer afterwards", async () => {
    mocks.listDictionaries.mockResolvedValue([entry("es_ES", "Spanish", "Spain")]);

    const first = await refreshDictionaryCatalog();
    const second = await loadDictionaryCatalog();

    expect(first).toBe(second);
    expect(mocks.listDictionaries).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure instead of caching the error forever", async () => {
    mocks.listDictionaries.mockRejectedValueOnce(new Error("no backend"));
    mocks.listDictionaries.mockResolvedValue([entry("it_IT", "Italian", "Italy")]);

    await expect(refreshDictionaryCatalog()).rejects.toThrow("no backend");
    await expect(loadDictionaryCatalog()).resolves.toHaveLength(1);
    expect(mocks.listDictionaries).toHaveBeenCalledTimes(2);
  });
});
