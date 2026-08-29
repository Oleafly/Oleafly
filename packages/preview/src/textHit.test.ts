import { describe, expect, it } from "vitest";
import { charOffsetAtHorizontalPosition, closestMatchingElement, snapAfterWord, wordAtHorizontalPosition, wordInText, wordOccurrenceIndex } from "./textHit";

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

describe("charOffsetAtHorizontalPosition", () => {
  it("maps a click position to a character offset proportionally", () => {
    expect(charOffsetAtHorizontalPosition("abcd", 100, 100, 100)).toBe(0);
    expect(charOffsetAtHorizontalPosition("abcd", 100, 100, 150)).toBe(2);
    expect(charOffsetAtHorizontalPosition("abcd", 100, 100, 200)).toBe(4);
  });

  it("clamps positions outside the span", () => {
    expect(charOffsetAtHorizontalPosition("abcd", 100, 100, 50)).toBe(0);
    expect(charOffsetAtHorizontalPosition("abcd", 100, 100, 400)).toBe(4);
    expect(charOffsetAtHorizontalPosition("", 100, 100, 150)).toBe(0);
  });
});

describe("snapAfterWord", () => {
  it("moves an offset inside a word to the end of that word", () => {
    expect(snapAfterWord("hello world", 2)).toBe(5);
    expect(snapAfterWord("hello world", 8)).toBe(11);
  });

  it("keeps an offset that is already at a boundary", () => {
    expect(snapAfterWord("hello world", 5)).toBe(5);
    expect(snapAfterWord("hello world", 11)).toBe(11);
  });

  it("clamps out-of-range offsets", () => {
    expect(snapAfterWord("abc", -2)).toBe(3);
    expect(snapAfterWord("abc", 99)).toBe(99 > 3 ? 3 : 99);
  });
});

describe("wordOccurrenceIndex", () => {
  const line = "The model uses a model of the model to predict the model output.";

  it("reports which occurrence of a repeated word sits at an offset", () => {
    expect(wordOccurrenceIndex(line, line.indexOf("model"))).toBe(0);
    expect(wordOccurrenceIndex(line, line.indexOf("model", 10))).toBe(1);
    expect(wordOccurrenceIndex(line, line.indexOf("model", 25))).toBe(2);
    expect(wordOccurrenceIndex(line, line.lastIndexOf("model"))).toBe(3);
  });

  it("counts from an offset in the middle of the clicked word", () => {
    expect(wordOccurrenceIndex(line, line.indexOf("model", 25) + 3)).toBe(2);
  });

  it("returns 0 for a word that appears once", () => {
    expect(wordOccurrenceIndex(line, line.indexOf("predict"))).toBe(0);
  });

  it("does not count substring matches inside longer words", () => {
    expect(wordOccurrenceIndex("modelling the model here", 18)).toBe(0);
  });

  it("returns 0 when the offset is not on a word", () => {
    expect(wordOccurrenceIndex("a  b", 2)).toBe(0);
    expect(wordOccurrenceIndex("", 0)).toBe(0);
  });
});
