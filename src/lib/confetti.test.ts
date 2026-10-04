import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confetti = vi.hoisted(() => vi.fn());
vi.mock("canvas-confetti", () => ({ default: confetti }));

import { celebrate } from "./confetti";

let reducedMotion = false;

beforeEach(() => {
  vi.useFakeTimers();
  confetti.mockReset();
  reducedMotion = false;
  vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: reducedMotion && query.includes("reduce") }) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("celebrate", () => {
  it("fires a central burst and then two side bursts", () => {
    celebrate();
    expect(confetti).toHaveBeenCalledOnce();
    expect(confetti.mock.calls[0][0]).toMatchObject({ particleCount: 140, origin: { y: 0.35 } });
    vi.advanceTimersByTime(180);
    expect(confetti).toHaveBeenCalledTimes(3);
    expect(confetti.mock.calls.slice(1).map(([options]) => options.origin)).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
  });

  it("stays still when the user prefers reduced motion", () => {
    reducedMotion = true;
    celebrate();
    vi.runAllTimers();
    expect(confetti).not.toHaveBeenCalled();
  });
});
