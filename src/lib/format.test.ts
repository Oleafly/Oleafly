import { describe, expect, it } from "vitest";
import { formatCompactCount } from "./format";

describe("formatCompactCount", () => {
  it("keeps counts below a thousand exact", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(532)).toBe("532");
    expect(formatCompactCount(999)).toBe("999");
  });

  it("uses one decimal below ten thousand and drops a trailing zero", () => {
    expect(formatCompactCount(1000)).toBe("1k");
    expect(formatCompactCount(5432)).toBe("5.4k");
    expect(formatCompactCount(9949)).toBe("9.9k");
  });

  it("rounds to whole thousands up to a million", () => {
    expect(formatCompactCount(10_000)).toBe("10k");
    expect(formatCompactCount(74_833)).toBe("75k");
    expect(formatCompactCount(330_000)).toBe("330k");
  });

  it("switches to millions with one decimal", () => {
    expect(formatCompactCount(1_300_000)).toBe("1.3M");
    expect(formatCompactCount(2_000_000)).toBe("2M");
  });

  it("treats unusable input as zero", () => {
    expect(formatCompactCount(Number.NaN)).toBe("0");
    expect(formatCompactCount(-5)).toBe("0");
  });
});
