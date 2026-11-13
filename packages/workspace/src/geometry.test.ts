import { describe, expect, it } from "vitest";
import { nearestEdge, sameRects } from "./geometry";

const square = { left: 0, top: 0, width: 100, height: 100 };

describe("workspace geometry", () => {
  it("keeps the earlier edge when two edges are equally near", () => {
    expect(nearestEdge(square, 50, 50)).toEqual(["left", 0.5]);
    expect(nearestEdge(square, 100, 0)).toEqual(["right", 0]);
    expect(nearestEdge(square, 50, 100)).toEqual(["bottom", 0]);
    expect(nearestEdge(square, 0, 0, false)).toEqual(["left", 0]);
  });

  it("tells rect maps apart when one is missing a key the other has", () => {
    expect(sameRects({ a: square }, { a: { ...square } })).toBe(true);
    expect(sameRects({ a: square }, { b: square })).toBe(false);
    expect(sameRects({ a: square }, { a: { ...square, top: 1 } })).toBe(false);
  });
});
