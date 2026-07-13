import { describe, it, expect } from "vitest";
import { clampRect } from "./overlay-rect";

const vp = { width: 1200, height: 800 };
describe("clampRect", () => {
  it("keeps a card fully on screen", () => {
    const r = clampRect({ x: 1190, y: 790, w: 400, h: 600 }, vp);
    expect(r.x + r.w).toBeLessThanOrEqual(1200);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
  it("enforces a minimum size", () => {
    const r = clampRect({ x: 0, y: 0, w: 50, h: 50 }, vp);
    expect(r.w).toBeGreaterThanOrEqual(320);
    expect(r.h).toBeGreaterThanOrEqual(400);
  });
  it("caps size to the viewport (no fullscreen blowout)", () => {
    const r = clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, vp);
    expect(r.w).toBeLessThanOrEqual(1200);
    expect(r.h).toBeLessThanOrEqual(800);
  });
});
