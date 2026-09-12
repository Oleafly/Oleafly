import { describe, expect, it } from "vitest";
import enEditor from "../../../src/i18n/locales/en/editor.json" with { type: "json" };
import { WYSIWYG_MESSAGE_KEYS } from "./messages";

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

describe("wysiwyg package messages", () => {
  it("declares a key for every string under editor.package.wysiwyg", () => {
    for (const key of WYSIWYG_MESSAGE_KEYS) {
      expect(typeof read(enEditor.package.wysiwyg, key), key).toBe("string");
    }
  });

  it("declares no key the catalog does not carry", () => {
    const declared = new Set<string>(WYSIWYG_MESSAGE_KEYS);
    const flat: string[] = [];
    flatten(enEditor.package.wysiwyg, "", flat);
    expect(flat.filter((key) => !declared.has(key))).toEqual([]);
  });
});
