import { describe, expect, it } from "vitest";
import { marqueeStep } from "./marquee";

describe("marqueeStep", () => {
  it("drifts toward the end and turns around when it lands there", () => {
    expect(marqueeStep(0, 100, 1, 10)).toEqual({ position: 10, direction: 1 });
    expect(marqueeStep(95, 100, 1, 10)).toEqual({ position: 100, direction: -1 });
  });

  it("drifts back and turns around at the start", () => {
    expect(marqueeStep(100, 100, -1, 10)).toEqual({ position: 90, direction: -1 });
    expect(marqueeStep(4, 100, -1, 10)).toEqual({ position: 0, direction: 1 });
  });

  it("stays put when there is nothing to scroll", () => {
    expect(marqueeStep(0, 0, 1, 10)).toEqual({ position: 0, direction: 1 });
    expect(marqueeStep(0, Number.NaN, 1, 10)).toEqual({ position: 0, direction: 1 });
  });

  it("clamps a position the user scrolled outside the range", () => {
    expect(marqueeStep(-40, 100, 1, 10)).toEqual({ position: 10, direction: 1 });
    expect(marqueeStep(180, 100, -1, 10)).toEqual({ position: 90, direction: -1 });
  });
});
