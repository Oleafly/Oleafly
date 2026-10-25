import { describe, expect, it } from "vitest";
import { isOutputLimitStop, isRefusalStop } from "./stop-reason";

describe("stop reasons", () => {
  it("recognises output-limit and refusal stops on every wire", () => {
    for (const reason of ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS", " length "]) {
      expect(isOutputLimitStop(reason)).toBe(true);
    }
    for (const reason of ["stop", "end_turn", "completed", "tool_use", null, undefined]) {
      expect(isOutputLimitStop(reason)).toBe(false);
    }
    for (const reason of ["refusal", "content_filter", "SAFETY"]) {
      expect(isRefusalStop(reason)).toBe(true);
    }
    for (const reason of ["stop", "length", null, undefined]) {
      expect(isRefusalStop(reason)).toBe(false);
    }
  });
});
