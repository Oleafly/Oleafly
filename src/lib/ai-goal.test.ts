import { describe, expect, it } from "vitest";
import { goalPromptLine } from "./ai-goal";

describe("goal prompt line", () => {
  it("adds the active goal to the assistant instructions", () => {
    expect(goalPromptLine("Finish the Stage 3 UX")).toBe(
      "Persistent goal: Finish the Stage 3 UX",
    );
  });

  it("keeps a multiline goal on one prompt line", () => {
    expect(goalPromptLine("  Finish the Stage 3\nUX\twithout regressions  ")).toBe(
      "Persistent goal: Finish the Stage 3 UX without regressions",
    );
  });

  it("omits the goal instruction when no goal is active", () => {
    expect(goalPromptLine("   ")).toBe("");
  });
});
