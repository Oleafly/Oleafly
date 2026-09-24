import { afterEach, describe, expect, it, vi } from "vitest";
import { randomFraction } from "./random";
import { fixRandomFraction } from "./test-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("randomFraction", () => {
  it("stays between 0 and 1", () => {
    for (let draw = 0; draw < 1_000; draw++) {
      const value = randomFraction();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("maps the lowest and highest draws to exactly 0 and 1", () => {
    fixRandomFraction(0);
    expect(randomFraction()).toBe(0);
    fixRandomFraction(1);
    expect(randomFraction()).toBe(1);
  });
});
