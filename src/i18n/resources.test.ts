import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAZY_NAMESPACES, NAMESPACES, englishResources, loadEnglishCatalog } from "./resources";

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
    expect(LAZY_NAMESPACES).toEqual(["collab"]);
    for (const namespace of LAZY_NAMESPACES) {
      expect(englishResources[namespace]).toBeUndefined();
    }
    expect(loadEnglishCatalog("shell")).toBeNull();
    expect(loadEnglishCatalog("not-a-namespace")).toBeNull();
  });
});
