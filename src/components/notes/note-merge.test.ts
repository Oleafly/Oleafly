import { describe, expect, it, vi } from "vitest";
import { mergeSequences } from "./note-merge";

describe("mergeSequences", () => {
  const key = (item: string) => item;

  it("takes theirs when ours matches the base", () => {
    expect(mergeSequences(["a", "b"], ["a", "b"], ["a", "c"], key)).toEqual(["a", "c"]);
  });

  it("keeps ours when theirs matches the base", () => {
    expect(mergeSequences(["a", "b"], ["a", "B"], ["a", "b"], key)).toEqual(["a", "B"]);
  });

  it("merges changes to different items", () => {
    expect(mergeSequences(["a", "b", "c", "d"], ["A", "b", "c", "d"], ["a", "b", "c", "D"], key)).toEqual(["A", "b", "c", "D"]);
  });

  it("keeps items only ours added and items only theirs added", () => {
    expect(mergeSequences(["a", "b", "c"], ["a", "b", "c", ""], ["x", "a", "b", "c"], key)).toEqual(["x", "a", "b", "c", ""]);
  });

  it("keeps adjacent changes from both sides", () => {
    expect(mergeSequences(["a", "b"], ["a ", "b"], ["a", "b!"], key)).toEqual(["a ", "b!"]);
  });

  it("takes theirs where only the source of an item changed", () => {
    expect(mergeSequences(["a", "b"], ["a ", "b"], ["a", "b"], key, { base: ["a ", "b"], theirs: ["a", "b"] })).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps ours when the sources did not change either", () => {
    expect(mergeSequences(["a"], ["a "], ["a"], key, { base: ["a"], theirs: ["a"] })).toEqual(["a "]);
  });

  it("keeps both insertions made at the same place", () => {
    expect(mergeSequences(["a"], ["a", ""], ["a", "new"], key)).toEqual(["a", "", "new"]);
  });

  it("prefers theirs where both changed the same item", () => {
    expect(mergeSequences(["a", "b", "c"], ["a", "B1", "c"], ["a", "B2", "c"], key)).toEqual(["a", "B2", "c"]);
  });

  it("handles deletions on both sides", () => {
    expect(mergeSequences(["a", "b", "c", "d", "e"], ["a", "c", "d", "e"], ["a", "b", "c", "e"], key)).toEqual(["a", "c", "e"]);
  });

  it("falls back to theirs when the diff gives up", async () => {
    const myers = await import("@/lib/myers-diff");
    const spy = vi.spyOn(myers, "myersEditScript").mockReturnValueOnce(null);
    try {
      expect(mergeSequences(["a"], ["b"], ["c"], key)).toEqual(["c"]);
    } finally {
      spy.mockRestore();
    }
  });
});
