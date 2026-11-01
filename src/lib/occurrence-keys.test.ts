import { describe, expect, it } from "vitest";
import { withOccurrenceKeys } from "./occurrence-keys";

describe("withOccurrenceKeys", () => {
  it("keys each item by its name and numbers repeats in order", () => {
    const keyed = withOccurrenceKeys(["a", "b", "a", "a"], (item) => item);
    expect(keyed.map((entry) => entry.key)).toEqual(["a", "b", "a#1", "a#2"]);
    expect(keyed.map((entry) => entry.item)).toEqual(["a", "b", "a", "a"]);
  });

  it("keeps an item's key when an unrelated item before it goes away", () => {
    const before = withOccurrenceKeys(["x", "a", "b"], (item) => item);
    const after = withOccurrenceKeys(["a", "b"], (item) => item);
    expect(after.map((entry) => entry.key)).toEqual(before.slice(1).map((entry) => entry.key));
  });

  it("returns an empty list for no items", () => {
    expect(withOccurrenceKeys([], String)).toEqual([]);
  });
});
