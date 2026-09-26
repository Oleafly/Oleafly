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

describe("PDF click words across scripts", () => {
  it.each([
    ["Hindi with virama and matras", "नमस्ते दुनिया", 1, "नमस्ते"],
    ["Hindi clicked inside the word", "यह हिन्दी भाषा है", 5, "हिन्दी"],
    ["Thai with above-base vowels", "สวัสดีครับ", 0, "สวัสดีครับ"],
    ["Hebrew with niqqud", "שָׁלוֹם עולם", 1, "שָׁלוֹם"],
    ["Persian with a zero-width non-joiner", "می‌خواهم رفتن", 0, "می‌خواهم"],
    ["a CJK Extension B character", "𠮷野家です", 1, "𠮷野家です"],
    ["decomposed Latin", "café noir", 2, "café"],
    ["an English contraction", "don’t stop", 1, "don"],
  ])("%s", (_label, text, offset, expected) => {
    expect(wordInText(text, offset)).toBe(expected);
  });

  it("does not extend a word across a joiner at its edge", () => {
    expect(wordInText("word‌ next", 1)).toBe("word");
  });
});
