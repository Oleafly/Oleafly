import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LAZY_NAMESPACES,
  NAMESPACES,
  englishResources,
  loadEnglishCatalog,
  loadLocaleCatalog,
  loadLocaleResources,
} from "./resources";

describe("English resources", () => {
  it("cover every namespace file shipped for en", async () => {
    const dir = fileURLToPath(new URL("./locales/en/", import.meta.url));
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
    expect(NAMESPACES).toEqual(files);
    for (const namespace of files) {
      const catalog = englishResources[namespace] ?? (await loadEnglishCatalog(namespace));
      expect(Object.keys(catalog ?? {}).length, namespace).toBeGreaterThan(0);
    }
  });

  it("keeps lazy namespaces out of the startup catalogs", () => {
    expect(LAZY_NAMESPACES).toEqual(["collab", "settingsFile"]);
    for (const namespace of LAZY_NAMESPACES) {
      expect(englishResources[namespace]).toBeUndefined();
    }
    expect(loadEnglishCatalog("shell")).toBeNull();
    expect(loadEnglishCatalog("not-a-namespace")).toBeNull();
  });
});

describe("translated resources", () => {
  it("leave lazy namespaces out of a language's startup catalogs", async () => {
    const russian = await loadLocaleResources("ru");
    expect(Object.keys(russian).sort()).toEqual(NAMESPACES.filter((namespace) => !LAZY_NAMESPACES.includes(namespace)));
  });

  it("load a lazy namespace for one language on its own", async () => {
    for (const namespace of LAZY_NAMESPACES) {
      const catalog = await loadLocaleCatalog("ru", namespace);
      expect(Object.keys(catalog ?? {}).length, namespace).toBeGreaterThan(0);
    }
    await expect(loadLocaleCatalog("ru", "shell")).resolves.toBeNull();
    await expect(loadLocaleCatalog("ru", "not-a-namespace")).resolves.toBeNull();
    await expect(loadLocaleCatalog("en", "collab")).resolves.toBeNull();
  });
});
