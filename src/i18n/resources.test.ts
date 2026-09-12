import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAMESPACES, englishResources } from "./resources";

describe("English resources", () => {
  it("cover every namespace file shipped for en", () => {
    const dir = fileURLToPath(new URL("./locales/en/", import.meta.url));
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
    expect(NAMESPACES).toEqual(files);
    for (const namespace of files) {
      expect(Object.keys(englishResources[namespace] ?? {}).length).toBeGreaterThan(0);
    }
  });
});
