import { describe, expect, it } from "vitest";
import { analyze, defineSchema, flagField, suggestAt } from "@oleafly/search-query";
import { buildSuggestions, type QueryMeta } from "./query-suggestions";

interface Item {
  readonly name: string;
  readonly engine: string;
  readonly starred: boolean;
  readonly created: number;
}

const schema = defineSchema<Item, QueryMeta>({
  fields: [
    flagField<Item, QueryMeta>("is", [{ value: "starred", meta: { label: "Starred" }, test: (item) => item.starred }], {
      meta: { label: "Is" },
    }),
    {
      key: "engine",
      meta: { label: "Engine" },
      type: "enum",
      options: [
        { value: "typst", meta: { label: "Typst" } },
        { value: "markdown", aliases: ["md"], meta: { label: "Markdown" } },
      ],
      test: (item, value) => item.engine === value,
    },
    { key: "created", meta: { label: "Created" }, type: "date", options: [{ value: "@today", meta: { label: "Today" } }], get: (item) => item.created },
    { key: "secret", hidden: true, type: "text", test: () => true },
  ],
  text: [
    { value: "name", meta: { label: "Name" }, get: (item) => item.name },
    { value: "body", meta: { label: "Body" }, get: (item) => item.name },
  ],
  textMeta: { label: "Search in" },
  sorts: [{ value: "name", meta: { label: "Name" }, compare: (a, b) => a.name.localeCompare(b.name) }],
  sortMeta: { label: "Sort" },
});

function suggest(source: string) {
  const caret = source.indexOf("|");
  const text = source.slice(0, caret) + source.slice(caret + 1);
  return buildSuggestions(suggestAt(analyze(text, schema, { now: 0 }), schema, caret), schema);
}

const ids = (source: string) => suggest(source).items.map((item) => item.id);
const operators = (source: string) => suggest(source).operators.map((item) => item.id);

describe("buildSuggestions", () => {
  it("lists visible fields and Exclude on an empty query", () => {
    expect(ids("|")).toEqual(["field:is", "field:engine", "field:created", "field:in", "field:sort"]);
    expect(operators("|")).toEqual(["operator:exclude"]);
  });

  it("adds AND and OR after a finished term", () => {
    expect(operators("engine:typst |")).toEqual(["operator:and", "operator:or", "operator:exclude"]);
  });

  it("filters fields by key, alias or label and ranks prefixes first", () => {
    expect(ids("en|")).toEqual(["field:engine"]);
    expect(ids("tod|")).toEqual([]);
    expect(ids("search|")).toEqual(["field:in"]);
    expect(ids("i|")).toEqual(["field:is", "field:in", "field:engine"]);
    expect(operators("en|")).toEqual([]);
  });

  it("titles the list Exclude after a dash and drops the operators", () => {
    const result = suggest("-|");
    expect(result.heading).toBe("exclude");
    expect(result.operators).toEqual([]);
  });

  it("offers values with the Exclude toggle first", () => {
    expect(ids("engine:|")).toEqual(["negate", "value:typst", "value:markdown"]);
    expect(suggest("-engine:|").items[0]).toMatchObject({ kind: "negate", negated: true });
    expect(ids("engine:m|")).toEqual(["value:markdown"]);
    expect(ids("engine:typst,|")).toEqual(["negate", "value:markdown"]);
  });

  it("does not offer Exclude for sort or in", () => {
    expect(ids("sort:|")).toEqual(["value:name-desc", "value:name-asc"]);
    expect(ids("in:|")).toEqual(["value:name", "value:body"]);
  });

  it("adds a date hint for date fields", () => {
    expect(suggest("created:|")).toMatchObject({ hint: "date" });
    expect(suggest("engine:|").hint).toBeNull();
  });

  it("offers nothing for unknown keys or inside phrases", () => {
    expect(suggest("colour:|").items).toEqual([]);
    expect(suggest('"some te|').items).toEqual([]);
  });
});
