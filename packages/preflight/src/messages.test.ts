import { describe, expect, it } from "vitest";
import catalog from "../../../src/i18n/locales/en/preflight.json" with { type: "json" };
import { PREFLIGHT_MESSAGE_KEYS } from "./messages";

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

function flatten(node: unknown, prefix: string, out: Set<string>): void {
  if (node === null || typeof node !== "object") {
    out.add(prefix);
    return;
  }
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    flatten(value, prefix ? `${prefix}.${name}` : name, out);
  }
}

const catalogKeys = new Set<string>();
flatten(catalog, "", catalogKeys);

const declared = new Set<string>(PREFLIGHT_MESSAGE_KEYS);

describe("preflight message keys", () => {
  it("declares every key as a catalog entry or a plural family", () => {
    const missing = [...declared].filter(
      (key) =>
        !catalogKeys.has(key) && !catalogKeys.has(`${key}_one`) && !catalogKeys.has(`${key}_other`),
    );
    expect(missing).toEqual([]);
  });

  it("has a declared key for every catalog entry", () => {
    const orphans = [...catalogKeys].filter((key) => !declared.has(key.replace(PLURAL_SUFFIX, "")));
    expect(orphans).toEqual([]);
  });

  it("declares complete plural families", () => {
    const plurals = [...declared].filter((key) => !catalogKeys.has(key));
    for (const key of plurals) {
      expect(catalogKeys.has(`${key}_one`), `${key}_one`).toBe(true);
      expect(catalogKeys.has(`${key}_other`), `${key}_other`).toBe(true);
    }
  });

  it("has no duplicate keys", () => {
    expect(declared.size).toBe(PREFLIGHT_MESSAGE_KEYS.length);
  });
});
