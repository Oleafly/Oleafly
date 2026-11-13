import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { compile } from "./evaluate";
import { defineSchema, flagField, mergeExtensions, type SearchExtension } from "./schema";

interface Item {
  readonly name: string;
  readonly starred: boolean;
  readonly size: number;
}

const ITEMS: readonly Item[] = [
  { name: "alpha", starred: true, size: 1 },
  { name: "beta", starred: false, size: 5 },
];

const BASE: SearchExtension<Item> = {
  is: [{ value: "starred", aliases: ["favorite"], test: (item) => item.starred }],
  text: [{ value: "name", get: (item) => item.name }],
};

const EXTRA: SearchExtension<Item> = {
  is: [{ value: "large", test: (item) => item.size > 3 }],
  fields: [{ key: "size", type: "number", get: (item) => item.size }],
  sorts: [{ value: "size", compare: (a, b) => a.size - b.size }],
};

function names(query: string, extensions: readonly SearchExtension<Item>[]): string[] {
  const parts = mergeExtensions(extensions);
  const schema = defineSchema<Item>({
    fields: [flagField("is", parts.is), ...parts.fields],
    text: parts.text,
    sorts: parts.sorts,
  });
  const compiled = compile(analyze(query, schema, { now: 0 }), schema, { now: 0 });
  return ITEMS.filter(compiled.test).map((item) => item.name);
}

describe("mergeExtensions", () => {
  it("joins every part of every extension in order and fills the missing ones", () => {
    const parts = mergeExtensions([BASE, EXTRA]);
    expect(parts.is.map((flag) => flag.value)).toEqual(["starred", "large"]);
    expect(parts.has).toEqual([]);
    expect(parts.fields.map((field) => field.key)).toEqual(["size"]);
    expect(parts.sorts.map((sort) => sort.value)).toEqual(["size"]);
    expect(parts.text.map((scope) => scope.value)).toEqual(["name"]);
    expect(mergeExtensions([])).toEqual({ is: [], has: [], fields: [], sorts: [], text: [] });
  });

  it("lets an extension add qualifiers to a schema built from another", () => {
    expect(names("is:favorite", [BASE])).toEqual(["alpha"]);
    expect(names("is:large", [BASE, EXTRA])).toEqual(["beta"]);
    expect(names("size:<3", [BASE, EXTRA])).toEqual(["alpha"]);
    expect(names("bet", [BASE, EXTRA])).toEqual(["beta"]);
  });
});
