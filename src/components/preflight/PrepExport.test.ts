import { describe, expect, it } from "vitest";
import { canPrepareAccessible } from "./prep-capability";

describe("accessible source preparation capability", () => {
  it("is strictly LaTeX-only and fail closed", () => {
    expect(canPrepareAccessible(true, "latex")).toBe(true);
    expect(canPrepareAccessible(true, "none")).toBe(false);
    expect(canPrepareAccessible(false, "latex")).toBe(false);
  });
});
