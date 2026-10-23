import { describe, expect, it } from "vitest";
import { pdfTextRuns } from "./pdfTextRuns";

describe("PDF text runs in SyncTeX's frame", () => {
  // A 792 pt tall page, unrotated: PDF y grows up, SyncTeX's down.
  const unrotated = { convertToViewportPoint: (x: number, y: number) => [x, 792 - y] };

  it("puts each run's top above its baseline by the font's ascent", () => {
    const runs = pdfTextRuns(
      {
        items: [
          { type: "beginMarkedContent" },
          { str: "model", transform: [10, 0, 0, 10, 100, 600], width: 30, fontName: "f1", hasEOL: true },
          { str: "data", transform: [10, 0, 0, 10, 140, 600], width: 22, fontName: "f2" },
        ],
        styles: { f1: { ascent: 0.75 }, f2: {} },
      },
      unrotated,
    );
    expect(runs).toEqual([
      { str: "model", x: 100, top: 184.5, width: 30, height: 10, hasEOL: true },
      { str: "data", x: 140, top: 184, width: 22, height: 10, hasEOL: undefined },
    ]);
  });
});
