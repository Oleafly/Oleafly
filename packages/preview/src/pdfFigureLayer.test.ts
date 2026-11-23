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

function pageWithForms(forms: number[][], ...images: number[][]) {
  return { formCoordinates: Float32Array.from(forms.flat()), imageCoordinates: Float32Array.from(images.flat()) };
}

type Rgb = readonly [number, number, number];

const PHOTO: Rgb = [200, 40, 40];
const SCANNED_PAPER: Rgb = [245, 244, 236];
const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [40, 35, 30];

function stubPixels(colorAt: (x: number, y: number) => Rgb) {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      drawImage,
      getImageData: (x: number, y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4).fill(255);
        for (let row = 0; row < height; row += 1) {
          for (let column = 0; column < width; column += 1) {
            const color = colorAt((x + column + 0.5) / canvas.width, (y + row + 0.5) / canvas.height);
            data.set(color, (row * width + column) * 4);
          }
        }
        return { data };
      },
    } as never;
  });
  return { drawImage };
}

function inside(box: number[], x: number, y: number): boolean {
  const [left, bottom, , top, right] = box;
  return x >= left && x < right && y >= top && y < bottom;
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

  it("leaves out included forms too small to be a figure, such as markers and bullets", () => {
    const markers = Array.from({ length: 6 }, (_, index) => imageAt(0.1 + index * 0.05, 0.1, 0.13 + index * 0.05, 0.12));
    const pdf = pageWithForms([...markers, imageAt(0.998, 0.3, 1.3, 0.5), imageAt(0.2, 0.5, 0.7, 0.8)]);
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const boxes = pdfFigureBoxes(pdf, viewport(1)).map((box) => [box.left, box.top, box.right, box.bottom].map((edge) => Number(edge.toFixed(4))));
    expect(boxes).toEqual([[0.2, 0.5, 0.7, 0.8]]);
  });

  it("caps pictures and included figures apart, so a figure made of many tiles keeps its box", () => {
    const tiles = Array.from({ length: MAX_PDF_FIGURES_PER_PAGE + 1 }, (_, index) => {
      const left = 0.1 + (index % 50) * 0.01;
      const top = 0.1 + Math.floor(index / 50) * 0.01;
      return imageAt(left, top, left + 0.008, top + 0.008);
    });
    const pdf = pageWithForms([imageAt(0.1, 0.1, 0.6, 0.6)], ...tiles);
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const boxes = pdfFigureBoxes(pdf, viewport(1)).map((box) => [box.left, box.top, box.right, box.bottom].map((edge) => Number(edge.toFixed(4))));
    expect(boxes).toEqual([[0.1, 0.1, 0.6, 0.6]]);
  });

  it("keeps every picture of a page right up to the limit", () => {
    const tiles = Array.from({ length: MAX_PDF_FIGURES_PER_PAGE }, (_, index) => {
      const left = 0.1 + (index % 50) * 0.01;
      const top = 0.1 + Math.floor(index / 50) * 0.01;
      return imageAt(left, top, left + 0.008, top + 0.008);
    });
    const pdf = page(...tiles);
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    expect(pdfFigureBoxes(pdf, viewport(1))).toHaveLength(MAX_PDF_FIGURES_PER_PAGE);
  });

  it("places an included PDF figure where pdf.js recorded its form", () => {
    const pdf = pageWithForms([imageAt(0.15, 0.2, 0.85, 0.55)]);
    expect(rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT })).toBe(true);
    const [box, ...rest] = pdfFigureBoxes(pdf, viewport(2));
    expect(rest).toEqual([]);
    expect([box.left, box.top, box.right, box.bottom].map((edge) => Number(edge.toFixed(4)))).toEqual([0.15, 0.2, 0.85, 0.55]);
  });

  it("keeps one box for a picture inside an included figure and for a picture drawn twice", () => {
    const twice = imageAt(0.7, 0.7, 0.8, 0.8);
    const roundedPast = imageAt(0.0996, 0.15, 0.55, 0.6004);
    const pdf = pageWithForms([imageAt(0.1, 0.1, 0.6, 0.6)], imageAt(0.2, 0.2, 0.3, 0.3), roundedPast, twice, twice);
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const boxes = pdfFigureBoxes(pdf, viewport(1)).map((box) => [box.left, box.top, box.right, box.bottom].map((edge) => Number(edge.toFixed(4))));
    expect(boxes).toEqual([
      [0.1, 0.1, 0.6, 0.6],
      [0.7, 0.7, 0.8, 0.8],
    ]);
  });

  it("keeps one box for a figure drawn over a photo", () => {
    const pdf = pageWithForms([imageAt(0.3, 0.3, 0.5, 0.5)], imageAt(0.1, 0.1, 0.9, 0.85));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const boxes = pdfFigureBoxes(pdf, viewport(1)).map((box) => [box.left, box.top, box.right, box.bottom].map((edge) => Number(edge.toFixed(4))));
    expect(boxes).toEqual([[0.1, 0.1, 0.9, 0.85]]);
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

  it("stops at the paper between figures that almost touch", () => {
    const ink = { x: 50, y: 40, right: 150, bottom: 120 };
    const neighbours = [ink, { x: 50, y: 121, right: 150, bottom: 200 }, { x: 151, y: 40, right: 250, bottom: 120 }];
    const read = (x: number, y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (const other of neighbours) {
        const painted = paperWithInk(other, x, y, width, height);
        for (let at = 0; at < data.length; at += 4) if (painted[at] !== 255) data.set(painted.subarray(at, at + 4), at);
      }
      return data;
    };
    expect(trimPaperEdges(ink, read, { width: 300, height: 200 })).toEqual(ink);
  });

  it("keeps a light gray plot background, as seaborn draws, inside the figure", () => {
    const plot = { x: 50, y: 40, right: 150, bottom: 120 };
    const read = (x: number, y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          if (inside(imageAt(plot.x, plot.y, plot.right, plot.bottom), x + column, y + row)) {
            data.set([234, 234, 242], (row * width + column) * 4);
          }
        }
      }
      return data;
    };
    expect(trimPaperEdges(plot, read, { width: 300, height: 200 })).toEqual(plot);
  });

  it("keeps the edge of a white figure on a tinted page", () => {
    const figure = { x: 50, y: 40, right: 150, bottom: 120 };
    const read = (x: number, y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          if (!inside(imageAt(figure.x, figure.y, figure.right, figure.bottom), x + column, y + row)) {
            data.set([250, 240, 200], (row * width + column) * 4);
          }
        }
      }
      return data;
    };
    expect(trimPaperEdges(figure, read, { width: 300, height: 200 })).toEqual(figure);
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

describe("PDF figure layer on pages filled with pictures", () => {
  afterEach(() => vi.restoreAllMocks());

  function paintPage(pdf: object) {
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = document.createElement("canvas");
    base.width = 1200;
    base.height = 1600;
    document.body.append(base);
    return { base, layers: paintPdfPageFigures(pdf, viewport(2), base) };
  }

  it("keeps a photo that bleeds over most of the page", () => {
    const photo = imageAt(0, 0.05, 1, 0.95);
    const { drawImage } = stubPixels((x, y) => (inside(photo, x, y) ? PHOTO : WHITE));
    const { base, layers } = paintPage(page(photo));
    expect(layers).toHaveLength(1);
    expect(drawImage).toHaveBeenLastCalledWith(base, 0, 80, 1200, 1440, 0, 0, 1200, 1440);
  });

  it("keeps a full-page photo with a wide bright sky", () => {
    stubPixels((_x, y) => (y < 0.58 ? [200, 220, 245] : [60, 90, 40]));
    expect(paintPage(page(imageAt(0, 0, 1, 1))).layers).toHaveLength(1);
  });

  it("leaves a scanned page to the page colors, whatever the color of its paper", () => {
    const grain = (x: number, y: number) => ((Math.floor(x * 997) * 31 + Math.floor(y * 991) * 17) % 41) - 20;
    for (const paper of [SCANNED_PAPER, [243, 231, 201], [217, 196, 160], [154, 154, 154], [220, 230, 245]] as const) {
      stubPixels((x, y) => (Math.floor(y * 60) % 6 === 0 ? [0, 0, 0] : (paper.map((channel) => channel + grain(x, y)) as unknown as Rgb)));
      expect(paintPage(page(imageAt(0, 0, 1, 1))).layers).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  it("leaves a page scanned in strips to the page colors", () => {
    stubPixels((_x, y) => (Math.floor(y * 60) % 6 === 0 ? INK : SCANNED_PAPER));
    const strips = Array.from({ length: 8 }, (_, index) => imageAt(0, index / 8, 1, (index + 1) / 8));
    expect(paintPage(page(...strips)).layers).toEqual([]);
  });

  it("leaves a page scanned in strips thinner than the probe's pixels to the page colors", () => {
    stubPixels((x) => (Math.floor(x * 60) % 6 === 0 ? INK : SCANNED_PAPER));
    const strips = Array.from({ length: 400 }, (_, index) => imageAt(0, index / 400, 1, (index + 1) / 400));
    expect(paintPage(page(...strips)).layers).toEqual([]);
  });

  it("keeps a slide's chart and photo when the slide background fills the page", () => {
    const chart = imageAt(0.1, 0.3, 0.6, 0.6);
    const photo = imageAt(0.65, 0.3, 0.9, 0.5);
    const framed = (x: number, y: number) => inside(chart, x, y) && !inside(imageAt(0.103, 0.303, 0.597, 0.597), x, y);
    const { drawImage } = stubPixels((x, y) => (inside(photo, x, y) ? PHOTO : framed(x, y) ? INK : WHITE));
    const { base, layers } = paintPage(pageWithForms([imageAt(0, 0, 1, 1), chart], photo));
    expect(layers).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledWith(base, 780, 480, 300, 320, 660, 0, 300, 320);
    expect(drawImage).toHaveBeenCalledWith(base, 120, 480, 600, 480, 0, 0, 600, 480);
  });

  it("leaves a page pulled in from another PDF to the page colors, but keeps the photo on it", () => {
    const photo = imageAt(0.2, 0.2, 0.5, 0.4);
    const { drawImage } = stubPixels((x, y) => (inside(photo, x, y) ? PHOTO : WHITE));
    const { base, layers } = paintPage(pageWithForms([imageAt(0, 0, 1, 1)], photo));
    expect(layers).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenLastCalledWith(base, 240, 320, 360, 320, 0, 0, 360, 320);
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

  it("draws a page of hundreds of small images onto one layer, reading the canvas once", () => {
    const pdf = page(...grid(500));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = sized(1200, 1600);
    const { drawImage, getImageData } = stubContexts();
    const canvases = countCanvases();
    expect(paintPdfPageFigures(pdf, viewport(2), base)).toHaveLength(1);
    expect(canvases()).toBe(1);
    expect(getImageData).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(500);
  });

  it("trims every figure of a page from a single read of the canvas", () => {
    const count = 40;
    const pdf = page(...grid(count));
    rememberPdfFigures(pdf, viewport(1), { width: PAGE_WIDTH, height: PAGE_HEIGHT });
    const base = sized(1200, 1600);
    const inks = Array.from({ length: count }, (_, index) => {
      const x = (index % 25) * 48;
      const y = Math.floor(index / 25) * 64;
      return { x: x + 1, y: y + 1, right: x + 23, bottom: y + 31 };
    });
    const drawImage = vi.fn();
    const getImageData = vi.fn((x: number, y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (const ink of inks) {
        for (let atY = Math.max(y, ink.y); atY < Math.min(y + height, ink.bottom); atY += 1) {
          for (let atX = Math.max(x, ink.x); atX < Math.min(x + width, ink.right); atX += 1) {
            data.set(PHOTO, ((atY - y) * width + (atX - x)) * 4);
          }
        }
      }
      return { data };
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, getImageData } as never);
    paintPdfPageFigures(pdf, viewport(2), base);
    expect(getImageData).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(count);
    for (const ink of inks) {
      expect(drawImage).toHaveBeenCalledWith(base, ink.x, ink.y, 22, 30, ink.x - 1, ink.y - 1, 22, 30);
    }
  });

  it("leaves a page with more pictures than it can handle to the page colors, with no layer and no reads", () => {
    const pdf = page(...grid(MAX_PDF_FIGURES_PER_PAGE + 1));
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

  it("frees a layer that fails to draw and leaves the page as it was", () => {
    const base = sized(1000, 1000);
    const broken = new Error("canvas lost");
    const drawImage = vi.fn(() => {
      throw broken;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    const created = vi.spyOn(document, "createElement");
    const source = { canvas: base, left: 0, top: 0, width: 1, height: 1 };
    expect(() => paintPdfFigures([{ left: 0.1, top: 0.1, right: 0.5, bottom: 0.5 }], source, base)).toThrow(broken);
    const [layer] = created.mock.results.map((result) => result.value).filter((value) => value instanceof HTMLCanvasElement);
    expect([layer.width, layer.height]).toEqual([0, 0]);
    expect(base.nextElementSibling).toBeNull();
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
    expect(reads).toBe(1);

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
    expect(getImageData).toHaveBeenCalledTimes(1);
    paintPdfPageFigures(pdf, viewport(3), sized(1800, 2400));
    expect(getImageData).toHaveBeenCalledTimes(2);
  });
});
