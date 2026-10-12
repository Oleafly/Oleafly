import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAZY_NAMESPACES, loadCatalog } from "./lazy-namespaces";
import { NAMESPACES, englishResources } from "./resources";

describe("English resources", () => {
  it("cover every namespace file shipped for en", async () => {
    const dir = fileURLToPath(new URL("./locales/en/", import.meta.url));
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
    expect([...NAMESPACES, ...LAZY_NAMESPACES].sort()).toEqual(files);
    for (const namespace of files) {
      const catalog = englishResources[namespace] ?? (await loadCatalog("en", namespace));
      expect(Object.keys(catalog ?? {}).length, namespace).toBeGreaterThan(0);
    }
  });

  it("keeps lazy namespaces out of the startup catalogs", () => {
    expect(LAZY_NAMESPACES).toEqual(["settingsFile"]);
    for (const namespace of LAZY_NAMESPACES) {
      expect(englishResources[namespace]).toBeUndefined();
    }
    expect(loadCatalog("en", "shell")).toBeNull();
    expect(loadCatalog("en", "not-a-namespace")).toBeNull();
  });
});
