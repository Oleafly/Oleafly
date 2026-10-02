import { describe, expect, it } from "vitest";
import {
  acceptField,
  acceptValue,
  insertAtCaret,
  suggestAt,
  toggleNegation,
  type FieldContext,
  type ValueContext,
} from "./suggest";
import { query, schema, type Doc } from "./testing";

function at(source: string) {
  const caret = source.indexOf("|");
  const text = source.replace("|", "");
  return { text, caret, context: suggestAt(query(text), schema, caret) };
}

describe("suggestAt", () => {
  it("offers fields on an empty query without operators", () => {
    expect(at("|").context).toEqual({ kind: "fields", from: 0, to: 0, prefix: "", negated: false, operators: false });
  });

  it("offers operators after a finished term", () => {
    expect(at("engine:typst |").context).toMatchObject({ kind: "fields", operators: true, prefix: "" });
    expect(at("(a OR |").context).toMatchObject({ kind: "fields", operators: false });
    expect(at("(|").context).toMatchObject({ kind: "fields", operators: false });
    expect(at("(a) |").context).toMatchObject({ kind: "fields", operators: true });
  });

  it("filters fields by the word being typed", () => {
    expect(at("draft eng|").context).toEqual({
      kind: "fields", from: 6, to: 9, prefix: "eng", negated: false, operators: false,
    });
    expect(at("-eng|").context).toMatchObject({ kind: "fields", from: 1, prefix: "eng", negated: true });
    expect(at("-|").context).toMatchObject({ kind: "fields", from: 1, to: 1, prefix: "", negated: true });
    expect(at("eng|ine:typst").context).toMatchObject({ kind: "fields", from: 0, to: 7, prefix: "eng" });
  });

  it("offers values after a key", () => {
    const { context } = at("engine:ty|");
    expect(context).toMatchObject({ kind: "values", key: "engine", prefix: "ty", from: 7, to: 9, taken: [] });
    expect((context as ValueContext<Doc>).field?.key).toBe("engine");
    expect(at("engine:|").context).toMatchObject({ kind: "values", prefix: "", from: 7, to: 7 });
    expect(at("engine:typst,|").context).toMatchObject({ kind: "values", prefix: "", taken: ["typst"] });
    expect(at('tag:"Needs Te|').context).toMatchObject({ kind: "values", prefix: "Needs Te", key: "tag" });
    expect(at("whatever:x|").context).toMatchObject({ kind: "values", key: "whatever", field: undefined });
  });

  it("offers nothing inside phrases and keywords", () => {
    expect(at('"lab no|').context).toEqual({ kind: "none" });
    expect(at("a AN|D b").context).toEqual({ kind: "none" });
    expect(at("(a)|").context).toEqual({ kind: "none" });
  });
});

describe("accepting suggestions", () => {
  it("inserts a key and leaves the caret after its colon", () => {
    const { text, context } = at("draft eng|");
    expect(acceptField(text, context as FieldContext, "engine")).toEqual({ value: "draft engine:", caret: 13 });
    const negated = at("-|");
    expect(acceptField(negated.text, negated.context as FieldContext, "is")).toEqual({ value: "-is:", caret: 4 });
    const middle = at("eng|ine:typst");
    expect(acceptField(middle.text, middle.context as FieldContext, "engine").value).toBe("engine:typst");
  });

  it("inserts a value and a trailing space", () => {
    const typed = at("engine:ty|");
    expect(acceptValue(typed.text, typed.context as ValueContext<Doc>, "typst")).toEqual({
      value: "engine:typst ",
      caret: 13,
    });
    const before = at("engine:ty| draft");
    expect(acceptValue(before.text, before.context as ValueContext<Doc>, "typst")).toEqual({
      value: "engine:typst draft",
      caret: 13,
    });
    const listed = at("engine:t|,md");
    expect(acceptValue(listed.text, listed.context as ValueContext<Doc>, "typst")).toEqual({
      value: "engine:typst,md",
      caret: 12,
    });
    const quoted = at("tag:Needs|");
    expect(acceptValue(quoted.text, quoted.context as ValueContext<Doc>, "Needs Testing").value).toBe(
      'tag:"Needs Testing" ',
    );
  });

  it("toggles the dash on the term being edited", () => {
    const plain = at("draft engine:ty|");
    expect(toggleNegation(plain.text, plain.context as ValueContext<Doc>, plain.caret)).toEqual({
      value: "draft -engine:ty",
      caret: 16,
    });
    const negated = at("-engine:ty|");
    expect((negated.context as ValueContext<Doc>).negation).toEqual({ start: 0, end: 1 });
    expect(toggleNegation(negated.text, negated.context as ValueContext<Doc>, negated.caret)).toEqual({
      value: "engine:ty",
      caret: 9,
    });
  });

  it("inserts operators with spacing", () => {
    expect(insertAtCaret("engine:typst ", 13, "OR ")).toEqual({ value: "engine:typst OR ", caret: 16 });
    expect(insertAtCaret("engine:typst", 12, "-")).toEqual({ value: "engine:typst -", caret: 14 });
    expect(insertAtCaret("(", 1, "-")).toEqual({ value: "(-", caret: 2 });
    expect(insertAtCaret("", 0, "-")).toEqual({ value: "-", caret: 1 });
  });
});
