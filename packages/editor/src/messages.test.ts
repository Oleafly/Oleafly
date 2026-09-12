import { describe, expect, it } from "vitest";
import enEditor from "../../../src/i18n/locales/en/editor.json" with { type: "json" };
import { EDITOR_MESSAGE_KEYS } from "./messages";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/u;

function read(catalog: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
}

function flatten(node: unknown, prefix: string, out: string[]): void {
  if (typeof node === "string") {
    out.push(prefix);
    return;
  }
  for (const [part, child] of Object.entries(node as Record<string, unknown>)) {
    flatten(child, prefix ? `${prefix}.${part}` : part, out);
  }
}

describe("editor package messages", () => {
  it("declares a key for every string under editor.package", () => {
    for (const key of EDITOR_MESSAGE_KEYS) {
      const direct = read(enEditor.package, key);
      if (typeof direct === "string") continue;
      expect(typeof read(enEditor.package, `${key}_other`), key).toBe("string");
      expect(typeof read(enEditor.package, `${key}_one`), key).toBe("string");
    }
  });

  it("declares no key the catalog does not carry", () => {
    const declared = new Set<string>(EDITOR_MESSAGE_KEYS);
    const flat: string[] = [];
    flatten(enEditor.package, "", flat);
    const unused = flat
      .filter((key) => !key.startsWith("wysiwyg."))
      .map((key) => key.replace(PLURAL_SUFFIX, ""))
      .filter((key) => !declared.has(key));
    expect([...new Set(unused)]).toEqual([]);
  });
});
