import { describe, expect, it } from "vitest";
import { closestMatchingElement, wordAtHorizontalPosition, wordInText } from "./textHit";

describe("PDF text hit testing", () => {
  it("finds a word at a text offset", () => {
    expect(wordInText("1 Introduction", 7)).toBe("Introduction");
  });

  it("maps a horizontal click to the matching word", () => {
    expect(wordAtHorizontalPosition("1 Introduction", 100, 140, 170)).toBe("Introduction");
  });

  it("clamps clicks outside the span", () => {
    expect(wordAtHorizontalPosition("First Last", 100, 100, 250)).toBe("Last");
  });

  it("accepts a cross-realm-like target without relying on instanceof", () => {
    const span = {} as Element;
    const target = {
      closest: (selector: string) => (selector === ".textLayer span" ? span : null),
    } as unknown as EventTarget;

    expect(closestMatchingElement(target, ".textLayer span")).toBe(span);
  });

  it("returns null for non-element event targets", () => {
    expect(closestMatchingElement({} as EventTarget, ".textLayer span")).toBeNull();
  });
});
