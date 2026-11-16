import { describe, expect, it } from "vitest";
import type { PdfTextRun } from "./pdfController";
import { findQuoteBoxes } from "./pdfQuote";

function run(str: string, x: number, top: number, width = str.length * 10, height = 10): PdfTextRun {
  return { str, x, top, width, height };
}

describe("findQuoteBoxes", () => {
  it("finds a quote inside one run and cuts the box by character offsets", () => {
    const runs = [run("The quick brown fox", 100, 50)];
    expect(findQuoteBoxes(4, runs, { text: "quick" })).toEqual([
      { page: 4, x: 140, y: 50, width: 50, height: 10 },
    ]);
  });

  it("spans runs and ignores whitespace differences", () => {
    const runs = [run("alpha be", 0, 20), run(" ", 80, 20), run("ta gamma", 0, 40, 80)];
    expect(findQuoteBoxes(1, runs, { text: "be  ta\ngam" })).toEqual([
      { page: 1, x: 60, y: 20, width: 20, height: 10 },
      { page: 1, x: 0, y: 40, width: 60, height: 10 },
    ]);
  });

  it("matches ligatures and compatibility forms", () => {
    const runs = [run("a ﬁne day", 0, 0, 90)];
    const boxes = findQuoteBoxes(1, runs, { text: "fine" });
    expect(boxes).toEqual([{ page: 1, x: 20, y: 0, width: 30, height: 10 }]);
  });

  it("prefers the match whose context agrees", () => {
    const runs = [run("see the result here", 0, 10), run("but the result there", 0, 30)];
    const boxes = findQuoteBoxes(2, runs, { text: "the result", before: "but", after: "there" });
    expect(boxes?.[0].y).toBe(30);
  });

  it("falls back to the match nearest the old position", () => {
    const runs = [run("x", 0, 10), run("x", 0, 300), run("x", 0, 600)];
    expect(findQuoteBoxes(1, runs, { text: "x" }, { y: 290 })?.[0].y).toBe(300);
    expect(findQuoteBoxes(1, runs, { text: "x" })?.[0].y).toBe(10);
  });

  it("weighs context over distance", () => {
    const runs = [run("one x two", 0, 10), run("three x four", 0, 500)];
    expect(findQuoteBoxes(1, runs, { text: "x", before: "three", after: "four" }, { y: 10 })?.[0].y).toBe(500);
  });

  it("returns null when the quote is missing or empty", () => {
    const runs = [run("alpha", 0, 0)];
    expect(findQuoteBoxes(1, runs, { text: "omega" })).toBeNull();
    expect(findQuoteBoxes(1, runs, { text: "  " })).toBeNull();
    expect(findQuoteBoxes(1, [], { text: "alpha" })).toBeNull();
  });
});
