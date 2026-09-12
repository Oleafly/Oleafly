import { describe, expect, it } from "vitest";
import enPreview from "../../../src/i18n/locales/en/preview.json" with { type: "json" };
import { PREVIEW_MESSAGE_KEYS } from "./messages";

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

describe("preview package messages", () => {
  it("declares a key for every string under preview.package", () => {
    for (const key of PREVIEW_MESSAGE_KEYS) {
      expect(typeof read(enPreview.package, key), key).toBe("string");
    }
  });

  it("declares no key the catalog does not carry", () => {
    const declared = new Set<string>(PREVIEW_MESSAGE_KEYS);
    expect(flatten(enPreview.package, "", []).filter((key) => !declared.has(key))).toEqual([]);
  });
});
