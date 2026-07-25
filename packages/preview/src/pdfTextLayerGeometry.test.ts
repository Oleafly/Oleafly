// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  calibratePdfTextLayerWidths,
  calibratedPdfTextScaleX,
} from "./pdfTextLayerGeometry";

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height: 20,
    top: 0,
    right: width,
    bottom: 20,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("PDF selectable text width calibration", () => {
  it("uses PDF advance, zoom, UserUnit and the browser minimum font size", () => {
    expect(
      calibratedPdfTextScaleX(
        300,
        120,
        { scale: 2, userUnit: 1.5 },
        4,
      ),
    ).toBe(4.8);
  });

  it.each([
    [0, 120, 1, 1],
    [120, 0, 1, 1],
    [Number.NaN, 120, 1, 1],
    [120, 120, 0, 1],
    [120, 120, 1, Number.POSITIVE_INFINITY],
  ])(
    "rejects invalid geometry (%s, %s, %s, %s)",
    (domAdvance, pdfAdvance, scale, userUnit) => {
      expect(
        calibratedPdfTextScaleX(
          domAdvance,
          pdfAdvance,
          { scale, userUnit },
          1,
        ),
      ).toBeNull();
    },
  );

  it("measures the local inline axis under parent and span rotation", () => {
    const container = document.createElement("div");
    container.style.setProperty("--min-font-size", "4");
    container.style.setProperty(
      "transform",
      "rotate(90deg) translateY(-100%)",
      "important",
    );

    const empty = document.createElement("span");
    const single = document.createElement("span");
    const horizontal = document.createElement("span");
    const vertical = document.createElement("span");
    single.style.setProperty("transform", "rotate(2deg)");
    horizontal.style.setProperty(
      "transform",
      "rotate(17deg) scaleX(0.75)",
      "important",
    );
    vertical.style.setProperty("transform", "rotate(90deg)");
    horizontal.style.setProperty("--scale-x", "0.75");
    vertical.style.setProperty("--scale-x", "0.5", "important");
    container.append(single, horizontal, vertical);

    const assertTransformsNeutralized = () => {
      expect(container.style.getPropertyValue("transform")).toBe("none");
      expect(container.style.getPropertyPriority("transform")).toBe("important");
      expect(single.style.getPropertyValue("transform")).toBe("none");
      expect(single.style.getPropertyPriority("transform")).toBe("important");
      expect(horizontal.style.getPropertyValue("transform")).toBe("none");
      expect(horizontal.style.getPropertyPriority("transform")).toBe("important");
      expect(vertical.style.getPropertyValue("transform")).toBe("none");
      expect(vertical.style.getPropertyPriority("transform")).toBe("important");
    };
    empty.getBoundingClientRect = vi.fn(() => rect(1));
    single.getBoundingClientRect = vi.fn(() => {
      assertTransformsNeutralized();
      return rect(20);
    });
    horizontal.getBoundingClientRect = vi.fn(() => {
      assertTransformsNeutralized();
      return rect(300);
    });
    vertical.getBoundingClientRect = vi.fn(() => {
      assertTransformsNeutralized();
      return rect(80);
    });

    const calibrated = calibratePdfTextLayerWidths(
      container,
      [empty, single, horizontal, vertical],
      {
        items: [
          { type: "beginMarkedContent" },
          { str: "", width: 0, height: 0, fontName: "horizontal" },
          { str: "X", width: 5, height: 13, fontName: "horizontal" },
          {
            str: "GEOMETRY PAGE ONE",
            width: 120,
            height: 13,
            fontName: "horizontal",
          },
          {
            str: "VERTICAL",
            width: 10,
            height: 40,
            fontName: "vertical",
          },
          { type: "endMarkedContent" },
        ],
        styles: {
          horizontal: { vertical: false },
          vertical: { vertical: true },
        },
      },
      { scale: 1, userUnit: 1.5 },
    );

    expect(calibrated).toBe(3);
    expect(single.style.getPropertyValue("--scale-x")).toBe("1.5");
    expect(horizontal.style.getPropertyValue("--scale-x")).toBe("2.4");
    expect(horizontal.style.getPropertyPriority("--scale-x")).toBe("");
    expect(vertical.style.getPropertyValue("--scale-x")).toBe("3");
    expect(vertical.style.getPropertyPriority("--scale-x")).toBe("important");
    expect(container.style.getPropertyValue("transform")).toBe(
      "rotate(90deg) translateY(-100%)",
    );
    expect(container.style.getPropertyPriority("transform")).toBe("important");
    expect(single.style.getPropertyValue("transform")).toBe("rotate(2deg)");
    expect(single.style.getPropertyPriority("transform")).toBe("");
    expect(horizontal.style.getPropertyValue("transform")).toBe(
      "rotate(17deg) scaleX(0.75)",
    );
    expect(horizontal.style.getPropertyPriority("transform")).toBe("important");
    expect(vertical.style.getPropertyValue("transform")).toBe("rotate(90deg)");
    expect(vertical.style.getPropertyPriority("transform")).toBe("");
    expect(empty.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("restores every transform if DOM measurement throws", () => {
    const container = document.createElement("div");
    const span = document.createElement("span");
    container.style.setProperty("transform", "rotate(90deg)");
    span.style.setProperty("transform", "rotate(12deg)", "important");
    span.getBoundingClientRect = () => {
      throw new Error("layout failed");
    };

    expect(() =>
      calibratePdfTextLayerWidths(
        container,
        [span],
        {
          items: [{ str: "TEXT", width: 20, height: 10, fontName: "font" }],
          styles: { font: {} },
        },
        { scale: 1, userUnit: 1 },
      ),
    ).toThrow("layout failed");
    expect(container.style.getPropertyValue("transform")).toBe("rotate(90deg)");
    expect(container.style.getPropertyPriority("transform")).toBe("");
    expect(span.style.getPropertyValue("transform")).toBe("rotate(12deg)");
    expect(span.style.getPropertyPriority("transform")).toBe("important");
  });
});
