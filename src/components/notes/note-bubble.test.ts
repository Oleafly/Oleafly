import { describe, expect, it } from "vitest";
import { bubblePlace } from "./note-bubble";

const anchor = (top: number, left: number) => ({ start: { top, left }, end: { bottom: top + 16 } });

describe("bubblePlace", () => {
  it("sits above the selection by the measured height when there is room", () => {
    expect(bubblePlace(anchor(200, 48), { width: 1000 }, { width: 420, height: 40 })).toEqual({ top: 152, left: 48 });
  });

  it("drops below the selection when the measured height does not fit above it", () => {
    expect(bubblePlace(anchor(40, 48), { width: 1000 }, { width: 420, height: 40 })).toEqual({ top: 64, left: 48 });
  });

  it("keeps a wide bubble inside the window", () => {
    expect(bubblePlace(anchor(200, 700), { width: 1000 }, { width: 420, height: 40 }).left).toBe(572);
    expect(bubblePlace(anchor(200, 0), { width: 1000 }, { width: 420, height: 40 }).left).toBe(8);
  });

  it("falls back to a default box before the bubble has a size", () => {
    expect(bubblePlace(anchor(20, 48), { width: 1000 }, { width: 0, height: 0 })).toEqual({ top: 44, left: 48 });
  });
});
