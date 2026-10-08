import { describe, expect, it } from "vitest";
import {
  MAX_PDF_DETAIL_PIXELS,
  pdfDetailArea,
  pdfDetailAreaCovers,
  pdfDetailTransform,
  pdfDevicePixelFraction,
  pdfVisibleArea,
} from "./pdfDetailGeometry";
import { MAX_PDF_CANVAS_PIXELS } from "./pdfLayerGeometry";

describe("pdfDetailGeometry", () => {
  it.each([
    [1, [1, 1]],
    [2, [2, 1]],
    [1.25, [5, 4]],
    [1.5, [3, 2]],
    [1.1, [11, 10]],
    [1.75, [7, 4]],
    [3, [3, 1]],
    [0, [1, 1]],
  ] as const)("expresses %s device pixels per CSS pixel as an exact fraction", (ratio, expected) => {
    expect(pdfDevicePixelFraction(ratio)).toEqual(expected);
  });

  it("falls back to pdf.js' approximation for an irrational ratio", () => {
    expect(pdfDevicePixelFraction(Math.SQRT2)).toEqual([7, 5]);
  });

  it("intersects the page with the scroll viewport in page coordinates", () => {
    expect(
      pdfVisibleArea(
        { left: -100, top: -250, right: 1430, bottom: 1730 },
        { left: 0, top: 0, right: 800, bottom: 600 },
      ),
    ).toEqual({ minX: 100, minY: 250, maxX: 900, maxY: 850 });
    expect(
      pdfVisibleArea(
        { left: 0, top: 700, right: 600, bottom: 1500 },
        { left: 0, top: 0, right: 800, bottom: 600 },
      ),
    ).toBeNull();
  });

  it("pads the visible area within the pixel budget and snaps it to device pixels", () => {
    const area = pdfDetailArea(
      { minX: 0, minY: 0, maxX: 800, maxY: 600 },
      1530,
      1980,
      2,
    );
    expect(area).not.toBeNull();
    expect(area!.minX).toBe(0);
    expect(area!.minY).toBe(0);
    expect(area!.width).toBeGreaterThanOrEqual(800);
    expect(area!.height).toBeGreaterThanOrEqual(600);
    expect(area!.canvasWidth).toBe(area!.width * 2);
    expect(area!.canvasHeight).toBe(area!.height * 2);
    expect(area!.canvasWidth * area!.canvasHeight).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
    expect(area!.outputScale).toBe(2);
  });

  it("always covers the visible area even when it alone exceeds the budget", () => {
    const area = pdfDetailArea(
      { minX: 100, minY: 200, maxX: 2500, maxY: 1600 },
      4000,
      5000,
      2,
    );
    expect(area!.minX).toBe(100);
    expect(area!.minY).toBe(200);
    expect(area!.width).toBe(2400);
    expect(area!.height).toBe(1400);
    expect(area!.canvasWidth).toBe(4800);
  });

  it("keeps detail edges on the fractional device pixel grid", () => {
    const area = pdfDetailArea(
      { minX: 10, minY: 6, maxX: 811, maxY: 607 },
      2448,
      3168,
      1.25,
    );
    for (const value of [area!.minX, area!.minY, area!.width, area!.height]) {
      expect(value % 4).toBe(0);
    }
    expect(area!.minX).toBeLessThanOrEqual(10);
    expect(area!.minY).toBeLessThanOrEqual(6);
    expect(area!.minX + area!.width).toBeGreaterThanOrEqual(811);
    expect(area!.minY + area!.height).toBeGreaterThanOrEqual(607);
    expect(Number.isInteger(area!.canvasWidth)).toBe(true);
    expect(Number.isInteger(area!.canvasHeight)).toBe(true);
    expect(area!.canvasWidth).toBe(area!.width * 1.25);
  });

  it("never extends past the page and respects the canvas dimension cap", () => {
    const area = pdfDetailArea(
      { minX: 1400, minY: 1900, maxX: 1530, maxY: 1980 },
      1530,
      1980,
      2,
    );
    expect(area!.minX + area!.width).toBeLessThanOrEqual(1530);
    expect(area!.minY + area!.height).toBeLessThanOrEqual(1980);
    const capped = pdfDetailArea(
      { minX: 0, minY: 0, maxX: 3000, maxY: 100 },
      3000,
      100,
      2,
      0,
      4000,
    );
    expect(capped!.canvasWidth).toBeLessThanOrEqual(4000);
  });

  it("lowers the detail resolution only when the visible area alone exceeds the detail budget", () => {
    const area = pdfDetailArea(
      { minX: 0, minY: 0, maxX: 4000, maxY: 2200 },
      8000,
      6000,
      2,
    )!;
    expect(area.outputScale).toBeLessThan(2);
    expect(area.canvasWidth * area.canvasHeight).toBeLessThanOrEqual(MAX_PDF_DETAIL_PIXELS * 1.01);
    expect(area.minX + area.width).toBeGreaterThanOrEqual(4000);
    expect(area.minY + area.height).toBeGreaterThanOrEqual(2200);
    expect(Number.isInteger(area.canvasWidth)).toBe(true);
    expect(Number.isInteger(area.canvasHeight)).toBe(true);
    const exact = pdfDetailArea(
      { minX: 0, minY: 0, maxX: 2500, maxY: 1500 },
      8000,
      6000,
      2,
    )!;
    expect(exact.outputScale).toBe(2);
  });

  it("returns null for an empty visible area", () => {
    expect(pdfDetailArea({ minX: 10, minY: 10, maxX: 10, maxY: 50 }, 600, 800, 2)).toBeNull();
  });

  it("reuses a detail area until the viewport drifts towards its edge", () => {
    const area = pdfDetailArea(
      { minX: 300, minY: 400, maxX: 700, maxY: 700 },
      1530,
      1980,
      2,
    )!;
    expect(pdfDetailAreaCovers(area, { minX: 300, minY: 400, maxX: 700, maxY: 700 }, 1530, 1980)).toBe(true);
    expect(pdfDetailAreaCovers(area, { minX: 320, minY: 420, maxX: 720, maxY: 720 }, 1530, 1980)).toBe(true);
    expect(pdfDetailAreaCovers(area, { minX: 300, minY: area.minY + area.height - 100, maxX: 700, maxY: area.minY + area.height + 50 }, 1530, 1980)).toBe(false);
    const nearTop = { minX: 300, minY: area.minY + 2, maxX: 700, maxY: area.minY + 302 };
    expect(pdfDetailAreaCovers(area, nearTop, 1530, 1980)).toBe(false);
    const flush = pdfDetailArea({ minX: 0, minY: 0, maxX: 400, maxY: 300 }, 1530, 1980, 2)!;
    expect(pdfDetailAreaCovers(flush, { minX: 0, minY: 0, maxX: 400, maxY: 300 }, 1530, 1980)).toBe(true);
  });

  it("builds the render transform that maps the area to the canvas origin", () => {
    expect(
      pdfDetailTransform({
        minX: 8,
        minY: 4,
        width: 100,
        height: 50,
        canvasWidth: 125,
        canvasHeight: 62.5,
        outputScale: 1.25,
      }),
    ).toEqual([1.25, 0, 0, 1.25, -10, -5]);
    expect(
      pdfDetailTransform({ minX: 0, minY: 0, width: 10, height: 10, canvasWidth: 20, canvasHeight: 20, outputScale: 2 }),
    ).toEqual([2, 0, 0, 2, 0, 0]);
  });
});
