import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampEffort,
  EFFORT_LEVELS,
  effortChoicesFor,
  isEffortLevel,
  type EffortLevel,
  type ModelReasoningMetadata,
} from "./effort";

interface EffortCase {
  provider: string;
  model: string;
  metadata: ModelReasoningMetadata | null;
  expected: EffortLevel[];
}

const cases: EffortCase[] = JSON.parse(
  readFileSync(
    join(process.cwd(), "crates/oleafly-agent/tests/fixtures/effort-cases.json"),
    "utf8",
  ),
);

describe("effortChoicesFor", () => {
  it.each(cases)("$provider $model", ({ provider, model, metadata, expected }) => {
    expect(effortChoicesFor(provider, model, metadata)).toEqual(expected);
  });

  it("ignores unknown option entries and effort names", () => {
    const metadata = {
      reasoning: true,
      reasoningOptions: [
        { type: "mystery" },
        { type: "effort", values: ["ultra", "high", "default", "low"] },
      ],
    } as unknown as ModelReasoningMetadata;
    expect(effortChoicesFor("openai", "gpt-6.1-sol", metadata)).toEqual(["low", "high"]);
  });
});

describe("clampEffort", () => {
  it("clamps to the nearest supported level, ties upward", () => {
    expect(clampEffort("xhigh", ["low", "medium", "high"])).toBe("high");
    expect(clampEffort("none", ["low", "medium", "high"])).toBe("low");
    expect(clampEffort("minimal", ["none", "low"])).toBe("low");
    expect(clampEffort("medium", ["low", "high"])).toBe("high");
    expect(clampEffort("high", ["high"])).toBe("high");
    expect(clampEffort("max", [])).toBeNull();
  });
});

describe("isEffortLevel", () => {
  it("accepts exactly the wire names", () => {
    for (const level of EFFORT_LEVELS) expect(isEffortLevel(level)).toBe(true);
    for (const value of ["off", "default", "", null, 3]) expect(isEffortLevel(value)).toBe(false);
  });
});
