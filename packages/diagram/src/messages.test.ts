import { describe, expect, it } from "vitest";
import enDiagram from "../../../src/i18n/locales/en/diagram.json" with { type: "json" };
import { DIAGRAM_MESSAGE_KEYS } from "./messages";

function read(catalog: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
}

describe("diagram package messages", () => {
  it("declares a key for every string under diagram.package", () => {
    for (const key of DIAGRAM_MESSAGE_KEYS) {
      expect(typeof read(enDiagram.package, key), key).toBe("string");
    }
  });

  it("declares no key the catalog does not carry", () => {
    const declared = new Set<string>(DIAGRAM_MESSAGE_KEYS);
    const flat: string[] = [];
    const walk = (node: unknown, prefix: string) => {
      if (typeof node === "string") {
        flat.push(prefix);
        return;
      }
      for (const [part, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${part}` : part);
      }
    };
    walk(enDiagram.package, "");
    expect(flat.filter((key) => !declared.has(key))).toEqual([]);
  });
});
