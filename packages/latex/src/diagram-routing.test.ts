import { describe, expect, it } from "vitest";
import { orthogonalRoute } from "./diagram-routing";

const origin = { x: 0, y: 0 };

describe("orthogonalRoute", () => {
  it("routes a straight facing pair through the step centre", () => {
    expect(orthogonalRoute(origin, { x: 0, y: 40 }, "b", "t", 20, 0.5)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
        { x: 0, y: 40 },
      ],
      label: { x: 0, y: 20 },
    });

    expect(orthogonalRoute(origin, { x: 0, y: -40 }, "t", "b", 20, 1)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: -20 },
        { x: 0, y: -40 },
      ],
      label: { x: 0, y: -20 },
    });
  });

  it("honours the step position on an offset facing pair", () => {
    expect(orthogonalRoute(origin, { x: 40, y: 40 }, "b", "t", 20, 0.25)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 40 },
      ],
      label: { x: 20, y: 20 },
    });
  });

  it("turns once for perpendicular handles", () => {
    expect(orthogonalRoute(origin, { x: 40, y: -40 }, "b", "r", 20, 0.5)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
        { x: 60, y: 20 },
        { x: 60, y: -40 },
        { x: 40, y: -40 },
      ],
      label: { x: 30, y: 20 },
    });
  });

  it("widens the gap when both ends share a handle and sit close together", () => {
    expect(orthogonalRoute(origin, { x: 19, y: 40 }, "b", "b", 20, 0.5)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
        { x: 0, y: 60 },
        { x: 19, y: 60 },
        { x: 19, y: 40 },
      ],
      label: { x: 0, y: 40 },
    });
  });

  it("routes back on itself when the target sits behind the source", () => {
    expect(orthogonalRoute(origin, { x: -40, y: 0 }, "r", "l", 20, 0.5)).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: -60, y: 0 },
        { x: -40, y: 0 },
      ],
      label: { x: -20, y: 0 },
    });
  });
});
