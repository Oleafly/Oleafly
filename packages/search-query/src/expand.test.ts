import { describe, expect, it } from "vitest";
import { expandQuery, truncatedDiagnostic } from "./expand";
import { parse } from "./parser";

const word = (token: { items: readonly { text: string }[] }) => [[token.items[0].text]];

describe("expandQuery", () => {
  it("returns null without a query or without any usable term", () => {
    expect(expandQuery(null, () => [["x"]])).toBeNull();
    expect(expandQuery(parse("a").root, () => null)).toBeNull();
  });

  it("multiplies AND across OR groups and says nothing was cut when everything fits", () => {
    expect(expandQuery(parse("(a OR b) (c OR d)").root, word)).toEqual({
      conjunctions: [
        ["a", "c"],
        ["a", "d"],
        ["b", "c"],
        ["b", "d"],
      ],
      truncated: false,
    });
  });

  it("caps the combinations and reports the cut", () => {
    const many = expandQuery(parse("(a OR b OR c) (d OR e OR f)").root, word, 4);
    expect(many).toEqual({
      conjunctions: [
        ["a", "d"],
        ["a", "e"],
        ["a", "f"],
        ["b", "d"],
      ],
      truncated: true,
    });
    expect(expandQuery(parse("a OR b OR c").root, word, 2)?.truncated).toBe(true);
  });

  it("keeps up to 32 combinations by default", () => {
    const nine = expandQuery(parse("(a OR b OR c) (d OR e OR f)").root, word);
    expect(nine?.conjunctions).toHaveLength(9);
    expect(nine?.truncated).toBe(false);
    const wide = expandQuery(parse("(a OR b OR c OR d OR e OR f) (g OR h OR i OR j OR k OR l)").root, word);
    expect(wide?.conjunctions).toHaveLength(32);
    expect(wide?.truncated).toBe(true);
  });

  it("keeps the one usable side of an AND, and gives nothing when no side is usable", () => {
    const onlyA = (token: { items: readonly { text: string }[] }) => (token.items[0].text === "a" ? [["a"]] : null);
    expect(expandQuery(parse("a b").root, onlyA)).toEqual({ conjunctions: [["a"]], truncated: false });
    expect(expandQuery(parse("(a OR c) b").root, onlyA, 1)).toEqual({ conjunctions: [["a"]], truncated: false });
    expect(expandQuery(parse("b c").root, onlyA)).toBeNull();
  });

  it("places the cut notice after the query so it never marks a term", () => {
    expect(truncatedDiagnostic("a OR b")).toEqual({ code: "too-many-branches", span: { start: 6, end: 6 } });
  });
});
