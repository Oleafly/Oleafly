import { describe, expect, it } from "vitest";
import { matchesMediaQuery } from "./use-media-query";

describe("media queries without a window", () => {
  it("never match", () => {
    expect(typeof window).toBe("undefined");
    expect(matchesMediaQuery("(min-width: 1px)")).toBe(false);
  });
});
