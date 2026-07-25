// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  applyPdfLayerViewport,
  applyPdfPlaceholderViewport,
  approximatePdfFraction,
  MAX_PDF_CANVAS_DIMENSION,
  MAX_PDF_CANVAS_PIXELS,
  pdfLayerGeometry,
  releasePdfRenderNodes,
  visitPdfPlaceholderBatch,
} from "./pdfLayerGeometry";

describe("pdfLayerGeometry", () => {
  it.each([
    [1.25, [5, 4]],
    [4 / 3, [4, 3]],
    [1.5, [3, 2]],
    [1.6, [8, 5]],
    [2, [2, 1]],
  ] as const)("matches pdf.js' DPR fraction for %s", (dpr, expected) => {
    expect(approximatePdfFraction(dpr)).toEqual(expected);
  });

  it("uses pdf.js' exact numerator/denominator rounding at fractional DPR", () => {
    const geometry = pdfLayerGeometry(
      {
        width: 611.5,
        height: 791.25,
        scale: 1,
        userUnit: 1,
        rotation: 0,
      },
      1.25,
      false,
    );

    expect(geometry).toEqual({
      cssWidth: "608px",
      cssHeight: "788px",
      cssWidthPx: 608,
      cssHeightPx: 788,
      canvasWidth: 760,
      canvasHeight: 985,
      outputScaleX: 1.25,
      outputScaleY: 1.25,
      scaleRoundX: 4,
      scaleRoundY: 4,
      restrictedScaling: false,
    });
  });

  it("uses float32 rounding when CSS round() has pdf.js-compatible precision", () => {
    const geometry = pdfLayerGeometry(
      {
        width: 611.999_999_99,
        height: 791.999_999_99,
        scale: 1,
        userUnit: 1,
        rotation: 0,
      },
      1.25,
      true,
    );

    expect(geometry.cssWidthPx).toBe(612);
    expect(geometry.cssHeightPx).toBe(792);
    expect(geometry.canvasWidth).toBe(765);
    expect(geometry.canvasHeight).toBe(990);
    expect(geometry.outputScaleX).toBe(1.25);
    expect(geometry.outputScaleY).toBe(1.25);
  });

  it("keeps canvas transform and CSS viewport rounding aligned at 4/3 DPR", () => {
    const geometry = pdfLayerGeometry(
      {
        width: 613.25,
        height: 794.75,
        scale: 1,
        userUnit: 1,
        rotation: 0,
      },
      4 / 3,
      false,
    );

    expect(geometry.cssWidthPx).toBe(612);
    expect(geometry.cssHeightPx).toBe(792);
    expect(geometry.canvasWidth).toBe(816);
    expect(geometry.canvasHeight).toBe(1_056);
    expect(geometry.outputScaleX).toBe(4 / 3);
    expect(geometry.outputScaleY).toBe(4 / 3);
    expect(geometry.scaleRoundX).toBe(3);
    expect(geometry.scaleRoundY).toBe(3);
  });

  it("hard-caps WebKit-safe canvas pixels without shrinking the page layers", () => {
    const geometry = pdfLayerGeometry(
      {
        width: 12_000,
        height: 18_000,
        scale: 20,
        userUnit: 1,
        rotation: 0,
      },
      2,
      false,
    );

    expect(geometry.restrictedScaling).toBe(true);
    expect(geometry.canvasWidth * geometry.canvasHeight).toBeLessThanOrEqual(
      MAX_PDF_CANVAS_PIXELS,
    );
    expect(geometry.canvasWidth).toBeLessThanOrEqual(MAX_PDF_CANVAS_DIMENSION);
    expect(geometry.canvasHeight).toBeLessThanOrEqual(MAX_PDF_CANVAS_DIMENSION);
    // CSS geometry remains near the exact 12k x 18k viewport; only its backing
    // raster is restricted. Text and annotations share these CSS dimensions.
    expect(geometry.cssWidthPx).toBeGreaterThan(11_990);
    expect(geometry.cssHeightPx).toBeGreaterThan(17_990);
    expect(geometry.outputScaleX).toBeLessThan(1);
    expect(geometry.outputScaleY).toBeLessThan(1);
  });

  it("zeros canvas backing stores even when callers retain stale node references", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4_096;
    canvas.height = 4_096;
    const layer = document.createElement("div");
    const nodes: HTMLElement[] = [canvas, layer];
    document.body.append(canvas, layer);

    releasePdfRenderNodes(nodes);

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(canvas.isConnected).toBe(false);
    expect(layer.isConnected).toBe(false);
    expect(nodes).toHaveLength(0);
  });

  it("sets the official page variables for a rotated non-1 UserUnit viewport", () => {
    const element = document.createElement("div");
    const geometry = applyPdfLayerViewport(
      element,
      {
        // 420x600 points, /Rotate 90, /UserUnit 1.5.
        width: 900,
        height: 630,
        scale: 1,
        userUnit: 1.5,
        rotation: 90,
      },
      1.25,
    );

    expect(geometry.cssWidthPx).toBe(900);
    expect(geometry.cssHeightPx).toBe(628);
    expect(element.style.width).toBe("900px");
    expect(element.style.height).toBe("628px");
    expect(element.style.getPropertyValue("--scale-factor")).toBe("1");
    expect(element.style.getPropertyValue("--user-unit")).toBe("1.5");
    expect(element.style.getPropertyValue("--total-scale-factor")).toBe(
      "calc(var(--scale-factor) * var(--user-unit))",
    );
    expect(element.style.getPropertyValue("--scale-round-x")).toBe("4px");
    expect(element.style.getPropertyValue("--scale-round-y")).toBe("4px");
  });

  it("scales each page from its own mixed-size geometry during transient zoom", () => {
    const letter = pdfLayerGeometry(
      { width: 1_224, height: 1_584, scale: 2, userUnit: 1, rotation: 0 },
      1.25,
      false,
    );
    const rotatedUserUnit = pdfLayerGeometry(
      { width: 1_800, height: 1_260, scale: 2, userUnit: 1.5, rotation: 90 },
      1.25,
      false,
    );

    expect(letter.cssWidthPx).toBe(1_224);
    expect(letter.cssHeightPx).toBe(1_584);
    expect(rotatedUserUnit.cssWidthPx).toBe(1_800);
    expect(rotatedUserUnit.cssHeightPx).toBe(1_260);
    expect(rotatedUserUnit.cssWidthPx / letter.cssWidthPx).toBeCloseTo(25 / 17, 12);
    expect(rotatedUserUnit.cssHeightPx / letter.cssHeightPx).toBeCloseTo(35 / 44, 12);
  });

  it("limits long-document placeholder zoom to one bounded animation-frame batch", () => {
    const pages = Array.from({ length: 400 }, (_, index) => {
      const page = document.createElement("div");
      return [index + 1, page] as const;
    });
    const iterator = pages.values();
    const visited: number[] = [];
    const finished = visitPdfPlaceholderBatch(iterator, 32, ([pageNumber, page]) => {
      visited.push(pageNumber);
      applyPdfPlaceholderViewport(
        page,
        {
          width: pageNumber % 2 === 0 ? 420 : 612,
          height: pageNumber % 2 === 0 ? 600 : 792,
          scale: 1,
          userUnit: pageNumber % 2 === 0 ? 1.5 : 1,
          rotation: pageNumber % 2 === 0 ? 90 : 0,
        },
        2,
        1.25,
      );
    });

    expect(finished).toBe(false);
    expect(visited).toHaveLength(32);
    expect(visited.at(-1)).toBe(32);
    expect(pages[31][1].style.width).toBe("840px");
    expect(pages[32][1].style.width).toBe("");
  });
});
