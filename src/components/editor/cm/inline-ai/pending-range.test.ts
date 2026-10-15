import { ChangeSet, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { changeTouchesRange, mapPendingRange } from "./pending-range";

const DOC_LENGTH = 30;
const RANGE = { from: 10, to: 20 };

function changes(spec: ChangeSpec) {
  return ChangeSet.of(spec, DOC_LENGTH);
}

describe("mapPendingRange", () => {
  it("shifts the range by an insert before it", () => {
    expect(mapPendingRange(changes({ from: 2, insert: "abc" }), RANGE)).toEqual({ from: 13, to: 23 });
  });

  it("shifts the range back by a deletion before it", () => {
    expect(mapPendingRange(changes({ from: 2, to: 6 }), RANGE)).toEqual({ from: 6, to: 16 });
  });

  it("leaves the range alone for edits after it", () => {
    expect(mapPendingRange(changes({ from: 25, to: 28, insert: "x" }), RANGE)).toEqual(RANGE);
  });

  it("keeps text typed at either edge outside the range", () => {
    expect(mapPendingRange(changes({ from: 10, insert: "ab" }), RANGE)).toEqual({ from: 12, to: 22 });
    expect(mapPendingRange(changes({ from: 20, insert: "ab" }), RANGE)).toEqual(RANGE);
  });

  it("grows and shrinks with edits inside it", () => {
    expect(mapPendingRange(changes({ from: 15, insert: "abc" }), RANGE)).toEqual({ from: 10, to: 23 });
    expect(mapPendingRange(changes({ from: 12, to: 14 }), RANGE)).toEqual({ from: 10, to: 18 });
  });

  it("collapses instead of inverting when a replacement swallows the range", () => {
    expect(mapPendingRange(changes({ from: 5, to: 25, insert: "new text" }), RANGE)).toEqual({ from: 5, to: 5 });
    expect(mapPendingRange(changes({ from: 5, to: 25 }), RANGE)).toEqual({ from: 5, to: 5 });
  });

  it("maps several changes in one set", () => {
    expect(
      mapPendingRange(changes([{ from: 0, insert: "ab" }, { from: 25, insert: "cd" }]), RANGE),
    ).toEqual({ from: 12, to: 22 });
  });
});

describe("changeTouchesRange", () => {
  it("ignores edits before and after the range", () => {
    expect(changeTouchesRange(changes({ from: 2, to: 6, insert: "x" }), RANGE)).toBe(false);
    expect(changeTouchesRange(changes({ from: 21, to: 30 }), RANGE)).toBe(false);
  });

  it("ignores inserts and edits that only meet an edge", () => {
    expect(changeTouchesRange(changes({ from: 10, insert: "x" }), RANGE)).toBe(false);
    expect(changeTouchesRange(changes({ from: 20, insert: "x" }), RANGE)).toBe(false);
    expect(changeTouchesRange(changes({ from: 4, to: 10, insert: "x" }), RANGE)).toBe(false);
    expect(changeTouchesRange(changes({ from: 20, to: 24 }), RANGE)).toBe(false);
  });

  it("flags an insert strictly inside the range", () => {
    expect(changeTouchesRange(changes({ from: 11, insert: "x" }), RANGE)).toBe(true);
    expect(changeTouchesRange(changes({ from: 19, insert: "x" }), RANGE)).toBe(true);
  });

  it("flags a deletion or replacement of any part of the range", () => {
    expect(changeTouchesRange(changes({ from: 8, to: 11 }), RANGE)).toBe(true);
    expect(changeTouchesRange(changes({ from: 19, to: 22, insert: "x" }), RANGE)).toBe(true);
    expect(changeTouchesRange(changes({ from: 12, to: 14, insert: "x" }), RANGE)).toBe(true);
    expect(changeTouchesRange(changes({ from: 0, to: 30, insert: "x" }), RANGE)).toBe(true);
  });

  it("finds the overlapping change among several", () => {
    expect(
      changeTouchesRange(changes([{ from: 2, insert: "a" }, { from: 15, insert: "b" }]), RANGE),
    ).toBe(true);
  });
});
