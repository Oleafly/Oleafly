// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  knowsPdfFigures,
  MAX_PDF_FIGURES_PER_PAGE,
  paintPdfDetailFigures,
  paintPdfFigures,
  paintPdfPageFigures,
  pdfFigureBoxes,
  pdfFigureProbeScale,
  rememberPdfFigures,
  trimPaperEdges,
} from "./pdfFigureLayer";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

function viewport(scale: number, rotation: 0 | 90 = 0) {
  const turned = rotation === 90;
  return {
    width: (turned ? PAGE_HEIGHT : PAGE_WIDTH) * scale,
    height: (turned ? PAGE_WIDTH : PAGE_HEIGHT) * scale,
    convertToPdfPoint(x: number, y: number) {
      return turned ? [y / scale, x / scale] : [x / scale, PAGE_HEIGHT - y / scale];
    },
    convertToViewportPoint(x: number, y: number) {
      return turned ? [y * scale, x * scale] : [x * scale, (PAGE_HEIGHT - y) * scale];
    },
  };
}

function imageAt(left: number, top: number, right: number, bottom: number): number[] {
  return [left, bottom, left, top, right, bottom];
}

function paperWithInk(
  ink: { x: number; y: number; right: number; bottom: number },
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const atX = x + column;
      const atY = y + row;
      if (atX >= ink.x && atX < ink.right && atY >= ink.y && atY < ink.bottom) {
        data.set([200, 40, 40], (row * width + column) * 4);
      }
    }
  }
  return data;
}

function page(...images: number[][]) {
  return { imageCoordinates: Float32Array.from(images.flat()) };
}

describe("PDF figure layer", () => {
  it("places an image where pdf.js recorded it, at any zoom", () => {
    const pdf = page(imageAt(0.1, 0.25, 0.6, 0.5));
    expect(rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT })).toBe(true);
    const [box] = pdfFigureBoxes(pdf, viewport(2.5));
    expect(box.left).toBeCloseTo(0.1);
    expect(box.top).toBeCloseTo(0.25);
    expect(box.right).toBeCloseTo(0.6);
    expect(box.bottom).toBeCloseTo(0.5);
  });

  it("follows the page when the view is rotated after recording", () => {
    const pdf = page(imageAt(0.1, 0.25, 0.6, 0.5));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const [box] = pdfFigureBoxes(pdf, viewport(1, 90));
    expect(box.left).toBeCloseTo(0.5);
    expect(box.top).toBeCloseTo(0.1);
    expect(box.right).toBeCloseTo(0.75);
    expect(box.bottom).toBeCloseTo(0.6);
  });

  it("reads the recording canvas in viewport units, not device pixels", () => {
    const pdf = page(imageAt(0.5, 0.5, 1, 1));
    rememberPdfFigures(pdf, viewport(2), { width: PAGE_WIDTH * 2, height: PAGE_HEIGHT * 2 });
    const [box] = pdfFigureBoxes(pdf, viewport(1));
    expect(box.left).toBeCloseTo(0.5);
    expect(box.bottom).toBeCloseTo(1);
  });

  it("treats a page that is mostly images as a scan, so it still goes dark", () => {
    const scan = page(imageAt(0, 0, 1, 0.5), imageAt(0, 0.5, 1, 1));
    rememberPdfFigures(scan, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(pdfFigureBoxes(scan, viewport(1))).toEqual([]);
  });

  it("keeps a page without images and a page never recorded apart", () => {
    const plain = page();
    const unknown = page();
    rememberPdfFigures(plain, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(knowsPdfFigures(plain)).toBe(true);
    expect(pdfFigureBoxes(plain, viewport(1))).toEqual([]);
    expect(knowsPdfFigures(unknown)).toBe(false);
    expect(rememberPdfFigures({ imageCoordinates: null }, viewport(1), { width: 1, height: 1 })).toBe(false);
  });

  it("drops images that fall outside the page", () => {
    const pdf = page(imageAt(1.2, 0.1, 1.5, 0.3));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(pdfFigureBoxes(pdf, viewport(1))).toEqual([]);
  });

  it("copies each figure from the canvas into its own unfiltered layer", () => {
    const drawImage = vi.fn();
    const ink = { x: 120, y: 400, right: 720, bottom: 800 };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData: (x: number, y: number, width: number, height: number) => ({ data: paperWithInk(ink, x, y, width, height) }),
    } as never);
    const wrap = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    wrap.append(canvas, document.createElement("div"));
    const [figure] = paintPdfFigures(
      [{ left: 0.1, top: 0.25, right: 0.6, bottom: 0.5 }],
      { canvas, left: 0, top: 0, width: 1, height: 1 },
      canvas,
    );
    expect(drawImage).toHaveBeenCalledWith(canvas, 120, 400, 600, 400, 0, 0, 600, 400);
    expect(canvas.nextElementSibling).toBe(figure);
    expect(figure.classList.contains("pdf-figure")).toBe(true);
    expect(figure.getAttribute("aria-hidden")).toBe("true");
    expect([figure.style.left, figure.style.top, figure.style.width, figure.style.height]).toEqual([
      "10%",
      "25%",
      "50%",
      "25%",
    ]);
    vi.restoreAllMocks();
  });

  it("copies only the part of a figure a detail canvas covers", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
      getImageData: (x: number, y: number, width: number, height: number) => ({
        data: paperWithInk({ x: 0, y: 0, right: 200, bottom: 200 }, x, y, width, height),
      }),
    } as never);
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 1000;
    document.body.append(canvas);
    const [figure] = paintPdfFigures(
      [{ left: 0.1, top: 0.1, right: 0.6, bottom: 0.6 }],
      { canvas, left: 0.5, top: 0.5, width: 0.5, height: 0.5 },
      canvas,
    );
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 200, 200, 0, 0, 200, 200);
    expect([figure.style.left, figure.style.width]).toEqual(["50%", "10%"]);
    vi.restoreAllMocks();
  });

  it("leaves no white page edge when the recorded box is a little too big", () => {
    const ink = { x: 50, y: 40, right: 150, bottom: 120 };
    const read = (x: number, y: number, width: number, height: number) => paperWithInk(ink, x, y, width, height);
    expect(trimPaperEdges({ x: 48, y: 38, right: 152, bottom: 122 }, read, { width: 300, height: 200 })).toEqual(ink);
  });

  it("reaches the real edge when the recorded box falls a little short", () => {
    const ink = { x: 50, y: 40, right: 150, bottom: 120 };
    const read = (x: number, y: number, width: number, height: number) => paperWithInk(ink, x, y, width, height);
    expect(trimPaperEdges({ x: 52, y: 42, right: 148, bottom: 118 }, read, { width: 300, height: 200 })).toEqual(ink);
  });

  it("stops at the canvas edge for a figure that bleeds off the page", () => {
    const ink = { x: 0, y: 0, right: 300, bottom: 200 };
    const read = (x: number, y: number, width: number, height: number) => paperWithInk(ink, x, y, width, height);
    expect(trimPaperEdges({ x: 0, y: 0, right: 300, bottom: 200 }, read, { width: 300, height: 200 })).toEqual(ink);
  });

  it("probes at a small, fixed size whatever the page", () => {
    expect(pdfFigureProbeScale({ width: 612, height: 792 }) * 792).toBeCloseTo(256);
    expect(pdfFigureProbeScale({ width: 0, height: 0 })).toBe(1);
  });
});

describe("PDF figure layer cost", () => {
  afterEach(() => vi.restoreAllMocks());

  function stubContexts(ink?: { x: number; y: number; right: number; bottom: number }) {
    const drawImage = vi.fn();
    const getImageData = vi.fn((x: number, y: number, width: number, height: number) => ({
      data: ink ? paperWithInk(ink, x, y, width, height) : new Uint8ClampedArray(width * height * 4),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, getImageData } as never);
    return { drawImage, getImageData };
  }

  function sized(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    document.body.append(canvas);
    return canvas;
  }

  function grid(count: number): number[][] {
    return Array.from({ length: count }, (_, index) => {
      const left = (index % 25) / 25;
      const top = Math.floor(index / 25) / 25;
      return imageAt(left, top, left + 0.02, top + 0.02);
    });
  }

  function countCanvases(): () => number {
    const created = vi.spyOn(document, "createElement");
    return () => created.mock.calls.filter(([tag]) => tag === "canvas").length;
  }

  it("leaves a page of hundreds of small images to the page colors, with no layer and no reads", () => {
    const pdf = page(...grid(500));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = sized(1200, 1600);
    const detail = sized(1200, 1600);
    const { getImageData } = stubContexts();
    const canvases = countCanvases();
    expect(paintPdfPageFigures(pdf, viewport(2), base)).toEqual([]);
    expect(paintPdfDetailFigures(pdf, viewport(2), { canvas: detail, left: 0, top: 0, width: 0.5, height: 0.5 }, base)).toEqual([]);
    expect(canvases()).toBe(0);
    expect(getImageData).not.toHaveBeenCalled();
    expect(pdfFigureBoxes(pdf, viewport(1))).toEqual([]);
  });

  it("draws a page with as many figures as it allows into one layer, reading four edges of each once", () => {
    const pdf = page(...grid(MAX_PDF_FIGURES_PER_PAGE));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = sized(1200, 1600);
    const { drawImage, getImageData } = stubContexts();
    const canvases = countCanvases();
    const layers = paintPdfPageFigures(pdf, viewport(2), base);
    expect(layers).toHaveLength(1);
    expect(canvases()).toBe(1);
    expect(drawImage).toHaveBeenCalledTimes(MAX_PDF_FIGURES_PER_PAGE);
    expect(getImageData).toHaveBeenCalledTimes(4 * MAX_PDF_FIGURES_PER_PAGE);
    expect(base.nextElementSibling).toBe(layers[0]);
  });

  it("puts every figure of a page on one layer at its own place", () => {
    const pdf = page(imageAt(0.1, 0.1, 0.3, 0.2), imageAt(0.5, 0.6, 0.9, 0.8));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = sized(1000, 1000);
    const { drawImage } = stubContexts();
    const [layer] = paintPdfFigures(pdfFigureBoxes(pdf, viewport(1)), { canvas: base, left: 0, top: 0, width: 1, height: 1 }, base);
    expect([layer.width, layer.height]).toEqual([800, 700]);
    expect(drawImage).toHaveBeenCalledWith(base, 100, 100, 200, 100, 0, 0, 200, 100);
    expect(drawImage).toHaveBeenCalledWith(base, 500, 600, 400, 200, 400, 500, 400, 200);
    expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height]).toEqual(["10%", "10%", "80%", "70%"]);
  });

  it("reuses the trimmed edges for the detail canvas without reading it", () => {
    const pdf = page(imageAt(0.1, 0.25, 0.6, 0.5));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = sized(1200, 1600);
    const { drawImage, getImageData } = stubContexts({ x: 121, y: 401, right: 719, bottom: 799 });
    paintPdfPageFigures(pdf, viewport(2), base);
    expect(drawImage).toHaveBeenCalledWith(base, 121, 401, 598, 398, 0, 0, 598, 398);
    const reads = getImageData.mock.calls.length;
    expect(reads).toBe(4);

    const detail = sized(1200, 1600);
    for (let pass = 0; pass < 3; pass++) {
      paintPdfDetailFigures(pdf, viewport(2), { canvas: detail, left: 0, top: 0, width: 0.5, height: 0.5 }, base);
    }
    expect(getImageData).toHaveBeenCalledTimes(reads);
    expect(drawImage).toHaveBeenLastCalledWith(detail, 244, 804, 956, 792, 0, 0, 956, 792);
  });

  it("trims a page again only when it is drawn sharper than before", () => {
    const pdf = page(imageAt(0.1, 0.25, 0.6, 0.5));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const { getImageData } = stubContexts();
    paintPdfPageFigures(pdf, viewport(2), sized(1200, 1600));
    paintPdfPageFigures(pdf, viewport(2), sized(1200, 1600));
    paintPdfPageFigures(pdf, viewport(1, 90), sized(800, 600));
    expect(getImageData).toHaveBeenCalledTimes(4);
    paintPdfPageFigures(pdf, viewport(3), sized(1800, 2400));
    expect(getImageData).toHaveBeenCalledTimes(8);
  });
});
