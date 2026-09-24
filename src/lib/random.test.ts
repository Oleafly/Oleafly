import { afterEach, describe, expect, it, vi } from "vitest";
import { randomFraction } from "./random";
import { fixRandomFraction } from "./test-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("randomFraction", () => {
  it("stays in [0, 1)", () => {
    for (let draw = 0; draw < 1_000; draw++) {
      const value = randomFraction();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("maps the lowest draw to 0 and the highest to the largest value below 1", () => {
    fixRandomFraction(0);
    expect(randomFraction()).toBe(0);
    fixRandomFraction(1);
    expect(randomFraction()).toBe(1 - 2 ** -52);
  });
});
