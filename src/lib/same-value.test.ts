import { describe, expect, it } from "vitest";
import { keepSame, sameValue } from "./same-value";

describe("same value", () => {
  it.each([
    [{ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }, true],
    [{ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }, false],
    [{ a: 1 }, { b: 1 }, false],
    [[1], { 0: 1 }, false],
    [null, null, true],
    [null, {}, false],
    [new Map([["k", [{ id: 1 }]]]), new Map([["k", [{ id: 1 }]]]), true],
    [new Map([["k", [{ id: 1 }]]]), new Map([["k", [{ id: 2 }]]]), false],
    [new Map([["k", 1]]), new Map([["j", 1]]), false],
    [new Set(["a"]), new Set(["a"]), true],
    [new Set(["a"]), new Set(["b"]), false],
  ])("compares %j with %j by value", (left, right, same) => {
    expect(sameValue(left, right)).toBe(same);
  });

  it("keeps the earlier object when the next one holds the same values", () => {
    const previous = { list: ["a"] };
    expect(keepSame(previous, { list: ["a"] })).toBe(previous);
    const next = { list: ["b"] };
    expect(keepSame(previous, next)).toBe(next);
  });
});
