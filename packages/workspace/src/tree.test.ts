import { describe, expect, it } from "vitest";
import { nearestEdge, zoneAt, zoneRect } from "./geometry";
import { edgeDirection, isLeadingEdge, normalWeights, pairBeside, reorder, spliceBeside } from "./tree";

describe("split tree helpers", () => {
  it("maps each edge to the direction it splits along and tells the leading ones", () => {
    expect(["left", "right", "top", "bottom"].map((edge) => edgeDirection(edge as "left"))).toEqual(["row", "row", "column", "column"]);
    expect(["left", "right", "top", "bottom"].map((edge) => isLeadingEdge(edge as "left"))).toEqual([true, false, true, false]);
  });

  it("normalizes weights and treats missing or broken ones as equal shares", () => {
    expect(normalWeights([1, 3], 2)).toEqual([0.25, 0.75]);
    expect(normalWeights([2, Number.NaN, -1], 3)).toEqual([0.5, 0.25, 0.25]);
    expect(normalWeights([], 2)).toEqual([0.5, 0.5]);
  });

  it("moves one entry to a new index", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("splits a sibling's weight with the entry placed beside it", () => {
    expect(spliceBeside(["a", "b"], [0.4, 0.6], 1, "x", "left", 0.5)).toEqual({ children: ["a", "x", "b"], weights: [0.4, 0.3, 0.3] });
    expect(spliceBeside(["a", "b"], [0.5, 0.5], 0, "x", "bottom", 0.25)).toEqual({ children: ["a", "x", "b"], weights: [0.375, 0.125, 0.5] });
  });

  it("pairs a target with a new entry on the chosen side", () => {
    expect(pairBeside("t", "x", "top", 0.2)).toEqual({ children: ["x", "t"], weights: [0.2, 0.8] });
    expect(pairBeside("t", "x", "right", 0.2)).toEqual({ children: ["t", "x"], weights: [0.8, 0.2] });
  });
});

describe("drop zone geometry", () => {
  const rect = { left: 100, top: 100, width: 400, height: 100 };

  it("measures the nearest edge as a share of the rect or in pixels", () => {
    expect(nearestEdge(rect, 180, 150)).toEqual(["left", 0.2]);
    expect(nearestEdge(rect, 180, 150, false)).toEqual(["top", 50]);
    expect(nearestEdge(rect, 50, 150, false)).toEqual(["left", -50]);
  });

  it("takes a custom edge share for the zone and the size of the box it covers", () => {
    expect(zoneAt(rect, 180, 150)).toBe("left");
    expect(zoneAt(rect, 180, 150, 0.1)).toBe("center");
    expect(zoneRect(rect, "right", 0.25)).toEqual({ left: 400, top: 100, width: 100, height: 100 });
    expect(zoneRect(rect, "bottom", 0.25)).toEqual({ left: 100, top: 175, width: 400, height: 25 });
  });

  it("reads a rect whose sides are getters, like a DOMRect", () => {
    class Measured {
      get left() {
        return 0;
      }
      get top() {
        return 0;
      }
      get width() {
        return 200;
      }
      get height() {
        return 100;
      }
    }
    expect(zoneRect(new Measured(), "left")).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });
});
