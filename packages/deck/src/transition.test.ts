import { describe, expect, it } from "vitest";
import type { Page } from "./sdk";
import { holdOpacity, resolveTransition, type SlideTransition } from "./transition";

describe("resolveTransition", () => {
  const plain: Page = () => null;
  const custom: Page = Object.assign(() => null, { transition: { duration: 100 } satisfies SlideTransition });
  const fallback: SlideTransition = { duration: 400 };

  it("prefers the page's own transition, then the deck default", () => {
    expect(resolveTransition([plain, custom], 1, fallback)).toEqual({ duration: 100 });
    expect(resolveTransition([plain, custom], 0, fallback)).toBe(fallback);
    expect(resolveTransition([plain, custom], 9, fallback)).toBe(fallback);
    expect(resolveTransition([plain], 0)).toBeUndefined();
  });
});

describe("holdOpacity", () => {
  it("removes opacity from keyframe lists and property maps, keeping the rest", () => {
    expect(holdOpacity(undefined)).toBeUndefined();
    expect(
      holdOpacity({ keyframes: [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1 }], duration: 200 }),
    ).toEqual({ keyframes: [{ transform: "scale(0.9)" }, {}], duration: 200 });
    expect(holdOpacity({ keyframes: { opacity: [0, 1], translate: ["0 10px", "0 0"] }, easing: "ease" })).toEqual({
      keyframes: { translate: ["0 10px", "0 0"] },
      easing: "ease",
    });
  });
});
