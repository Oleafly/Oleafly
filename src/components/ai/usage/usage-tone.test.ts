import { describe, expect, it } from "vitest";
import { contextFraction, usageTone, windowTone } from "./usage-tone";

describe("usage tone", () => {
  it("grades context use at 75 and 90 percent", () => {
    expect(usageTone(0.74)).toBe("normal");
    expect(usageTone(0.75)).toBe("warning");
    expect(usageTone(0.9)).toBe("warning");
    expect(usageTone(0.901)).toBe("critical");
    expect(usageTone(Number.NaN)).toBe("normal");
  });

  it("grades a plan window by its status before its utilization", () => {
    expect(windowTone({ id: "a", label: "5h", utilization: 0.1, status: "blocked" })).toBe("critical");
    expect(windowTone({ id: "a", label: "5h", utilization: 0.1, status: "warning" })).toBe("warning");
    expect(windowTone({ id: "a", label: "5h", utilization: 0.95 })).toBe("critical");
  });

  it("reads the share of the context window, or nothing when unknown", () => {
    expect(contextFraction({ context: { used: 50, size: 200 } })).toBe(0.25);
    expect(contextFraction({ context: { used: 500, size: 200 } })).toBe(1);
    expect(contextFraction({ context: { used: 5, size: 0 } })).toBeNull();
    expect(contextFraction({})).toBeNull();
  });
});
