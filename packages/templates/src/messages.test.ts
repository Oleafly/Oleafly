import { describe, expect, it } from "vitest";
import enTemplates from "../../../src/i18n/locales/en/templates.json" with { type: "json" };
import { TEMPLATES_MESSAGE_KEYS } from "./messages";

function read(catalog: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
}

function flatten(node: unknown, prefix: string, out: string[]): string[] {
  if (typeof node === "string") {
    out.push(prefix);
    return out;
  }
  for (const [part, child] of Object.entries(node as Record<string, unknown>)) {
    flatten(child, prefix ? `${prefix}.${part}` : part, out);
  }
  return out;
}

describe("templates package messages", () => {
  it("declares a key for every string under templates.package", () => {
    for (const key of TEMPLATES_MESSAGE_KEYS) {
      expect(typeof read(enTemplates.package, key), key).toBe("string");
    }
  });

  it("declares no key the catalog does not carry", () => {
    const declared = new Set<string>(TEMPLATES_MESSAGE_KEYS);
    expect(flatten(enTemplates.package, "", []).filter((key) => !declared.has(key))).toEqual([]);
  });
});
