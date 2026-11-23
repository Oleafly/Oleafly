type PdfPoint = readonly [number, number];
type PdfFigure = readonly [PdfPoint, PdfPoint, PdfPoint];

type PdfFigureConverter = (x: number, y: number) => number[];

interface PdfFigureViewport {
  width: number;
  height: number;
  convertToPdfPoint?: PdfFigureConverter;
  convertToViewportPoint?: PdfFigureConverter;
}

interface PdfFigurePage {
  imageCoordinates?: ArrayLike<number> | null;
  formCoordinates?: ArrayLike<number> | null;
}

interface PdfFigureBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PdfFigureSource {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

const PDF_FIGURE_CLASSES = `pdf-figure pointer-events-none absolute z-[2] hidden group-data-[pdf-colors=dark]/pdf:block`;

const PAGE_FILLING_COVERAGE = 0.8;

const PROBE_LONGEST_SIDE_PX = 256;

export const MAX_PDF_FIGURES_PER_PAGE = 500;

const MIN_FORM_AREA = 0.002;

const CONTAINED_SLACK = 0.002;

const SCAN_PAPER_LIGHTNESS = 140;

const SCAN_PAPER_SPREAD = 32;

const SCAN_PAPER_SHARE = 0.65;

const SCAN_MIN_SAMPLES = 16;

interface TrimmedFigures {
  readonly figures: readonly PdfFigure[];
  readonly pixelsPerUnit: number;
}

const figuresByPage = new WeakMap<object, readonly PdfFigure[]>();

const trimmedByPage = new WeakMap<object, TrimmedFigures>();

export function knowsPdfFigures(page: object): boolean {
  return figuresByPage.has(page);
}

export function pdfFigureProbeScale(viewportAtScaleOne: { width: number; height: number }): number {
  const longest = Math.max(viewportAtScaleOne.width, viewportAtScaleOne.height);
  return longest > 0 ? PROBE_LONGEST_SIDE_PX / longest : 1;
}

export function rememberPdfFigures(
  page: PdfFigurePage & object,
  recordedWith: PdfFigureViewport,
  canvasInViewportUnits: { width: number; height: number },
): boolean {
  if (figuresByPage.has(page)) return true;
  const images = page.imageCoordinates;
  const toPdf = recordedWith.convertToPdfPoint;
  if (!images || !toPdf) return false;
  const point = (coordinates: ArrayLike<number>, at: number): PdfPoint => {
    const [x, y] = toPdf.call(
      recordedWith,
      coordinates[at] * canvasInViewportUnits.width,
      coordinates[at + 1] * canvasInViewportUnits.height,
    );
    return [x, y];
  };
  const collect = (coordinates: ArrayLike<number>, minArea: number): PdfFigure[] => {
    const figures: PdfFigure[] = [];
    for (let at = 0; at + 5 < coordinates.length; at += 6) {
      if (fractionArea(coordinates, at) < minArea) continue;
      figures.push([point(coordinates, at), point(coordinates, at + 2), point(coordinates, at + 4)]);
    }
    return figures.length > MAX_PDF_FIGURES_PER_PAGE ? [] : figures;
  };
  figuresByPage.set(page, [...collect(page.formCoordinates ?? [], MIN_FORM_AREA), ...collect(images, 0)]);
  return true;
}

function fractionArea(coordinates: ArrayLike<number>, at: number): number {
  const [ax, ay, bx, by, cx, cy] = Array.from({ length: 6 }, (_, index) => coordinates[at + index]);
  const xs = [ax, bx, cx, bx + cx - ax].map((x) => Math.min(1, Math.max(0, x)));
  const ys = [ay, by, cy, by + cy - ay].map((y) => Math.min(1, Math.max(0, y)));
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

function viewportBox(figure: PdfFigure, viewport: PdfFigureViewport, toViewport: PdfFigureConverter): PdfFigureBox {
  const [a, b, c] = figure.map(([x, y]) => toViewport.call(viewport, x, y));
  const xs = [a[0], b[0], c[0], b[0] + c[0] - a[0]].map((x) => x / viewport.width);
  const ys = [a[1], b[1], c[1], b[1] + c[1] - a[1]].map((y) => y / viewport.height);
  return {
    left: Math.max(0, Math.min(...xs)),
    top: Math.max(0, Math.min(...ys)),
    right: Math.min(1, Math.max(...xs)),
    bottom: Math.min(1, Math.max(...ys)),
  };
}

function area(box: PdfFigureBox): number {
  return (box.right - box.left) * (box.bottom - box.top);
}

function contains(outer: PdfFigureBox, inner: PdfFigureBox): boolean {
  return (
    outer.left - CONTAINED_SLACK <= inner.left &&
    outer.top - CONTAINED_SLACK <= inner.top &&
    outer.right + CONTAINED_SLACK >= inner.right &&
    outer.bottom + CONTAINED_SLACK >= inner.bottom
  );
}

function outermost(boxes: readonly PdfFigureBox[]): PdfFigureBox[] {
  const kept: PdfFigureBox[] = [];
  for (const box of [...boxes].sort((a, b) => area(b) - area(a))) {
    if (!kept.some((outer) => contains(outer, box))) kept.push(box);
  }
  return kept;
}

function figureBoxes(figures: readonly PdfFigure[], viewport: PdfFigureViewport): PdfFigureBox[] {
  const toViewport = viewport.convertToViewportPoint;
  if (!toViewport || viewport.width <= 0 || viewport.height <= 0) return [];
  return figures.map((figure) => viewportBox(figure, viewport, toViewport)).filter((box) => area(box) > 0);
}

function coverage(boxes: readonly PdfFigureBox[]): number {
  return boxes.reduce((sum, box) => sum + area(box), 0);
}

function shownBoxes(page: object, viewport: PdfFigureViewport, canvas: HTMLCanvasElement | null): PdfFigureBox[] {
  const found = figureBoxes(figuresByPage.get(page) ?? [], viewport);
  const outer = outermost(found);
  if (coverage(outer) < PAGE_FILLING_COVERAGE) return outer;
  const sample = canvas ? pageSample(canvas) : null;
  if (!sample) return [];
  const pictures = found.filter((box) => area(box) < PAGE_FILLING_COVERAGE || !scanLike(sample, box));
  const rest = outermost(pictures);
  if (coverage(rest) < PAGE_FILLING_COVERAGE) return rest;
  return outermost(pictures.filter((box) => !scanLike(sample, box)));
}

export function pdfFigureBoxes(page: object, viewport: PdfFigureViewport): PdfFigureBox[] {
  return shownBoxes(page, viewport, null);
}

function pdfExtent(viewport: PdfFigureViewport, toX: number, toY: number): number {
  const toPdf = viewport.convertToPdfPoint;
  if (!toPdf) return 0;
  const [x0, y0] = toPdf.call(viewport, 0, 0);
  const [x1, y1] = toPdf.call(viewport, toX, toY);
  return Math.hypot(x1 - x0, y1 - y0);
}

function pixelsPerUnit(viewport: PdfFigureViewport, canvas: { width: number }): number {
  const extent = pdfExtent(viewport, viewport.width, 0);
  return extent > 0 ? canvas.width / extent : 0;
}

function inPdfSpace(box: PdfFigureBox, viewport: PdfFigureViewport): PdfFigure | null {
  const toPdf = viewport.convertToPdfPoint;
  if (!toPdf) return null;
  const point = (x: number, y: number): PdfPoint => {
    const [pdfX, pdfY] = toPdf.call(viewport, x * viewport.width, y * viewport.height);
    return [pdfX, pdfY];
  };
  return [point(box.left, box.top), point(box.left, box.bottom), point(box.right, box.top)];
}

const EDGE_SEARCH_PX = 3;

const PAPER_LEVEL = 250;

interface PixelRect {
  x: number;
  y: number;
  right: number;
  bottom: number;
}

type ReadPixels = (x: number, y: number, width: number, height: number) => ArrayLike<number>;

function inkAt(pixels: ArrayLike<number>, index: number): boolean {
  return pixels[index] < PAPER_LEVEL || pixels[index + 1] < PAPER_LEVEL || pixels[index + 2] < PAPER_LEVEL;
}

interface InkStrip {
  readonly from: number;
  readonly ink: readonly boolean[];
}

function inkColumns(read: ReadPixels, from: number, to: number, y: number, height: number): InkStrip {
  const width = to - from;
  if (width <= 0 || height <= 0) return { from, ink: [] };
  const pixels = read(from, y, width, height);
  const ink = Array.from({ length: width }, (_, column) => {
    for (let row = 0; row < height; row += 1) if (inkAt(pixels, (row * width + column) * 4)) return true;
    return false;
  });
  return { from, ink };
}

function inkRows(read: ReadPixels, from: number, to: number, x: number, width: number): InkStrip {
  const height = to - from;
  if (width <= 0 || height <= 0) return { from, ink: [] };
  const pixels = read(x, from, width, height);
  const ink = Array.from({ length: height }, (_, row) => {
    for (let column = 0; column < width; column += 1) if (inkAt(pixels, (row * width + column) * 4)) return true;
    return false;
  });
  return { from, ink };
}

function settleEdge(strip: InkStrip, edge: number, outward: 1 | -1): number {
  const inkAtPixel = (pixel: number) => strip.ink[pixel - strip.from];
  const inside = (boundary: number) => (outward === 1 ? boundary - 1 : boundary);
  const outside = (boundary: number) => (outward === 1 ? boundary : boundary - 1);
  let boundary = edge;
  if (inkAtPixel(inside(boundary))) {
    while (inkAtPixel(outside(boundary))) boundary += outward;
  } else if (!inkAtPixel(outside(boundary))) {
    while (inkAtPixel(inside(boundary)) === false) boundary -= outward;
  }
  return boundary;
}

export function trimPaperEdges(rect: PixelRect, read: ReadPixels, size: { width: number; height: number }): PixelRect {
  const reach = EDGE_SEARCH_PX;
  const height = rect.bottom - rect.y;
  const leftStrip = inkColumns(read, Math.max(0, rect.x - reach), Math.min(rect.right, rect.x + reach + 1), rect.y, height);
  const x = settleEdge(leftStrip, rect.x, -1);
  const rightStrip = inkColumns(read, Math.max(x, rect.right - reach - 1), Math.min(size.width, rect.right + reach), rect.y, height);
  const right = settleEdge(rightStrip, rect.right, 1);
  const topStrip = inkRows(read, Math.max(0, rect.y - reach), Math.min(rect.bottom, rect.y + reach + 1), x, right - x);
  const y = settleEdge(topStrip, rect.y, -1);
  const bottomStrip = inkRows(read, Math.max(y, rect.bottom - reach - 1), Math.min(size.height, rect.bottom + reach), x, right - x);
  const bottom = settleEdge(bottomStrip, rect.bottom, 1);
  return { x, y, right, bottom };
}

function percent(fraction: number): string {
  return `${fraction * 100}%`;
}

const WHOLE_PAGE: Omit<PdfFigureSource, "canvas"> = { left: 0, top: 0, width: 1, height: 1 };

const NO_INSET = { x: 0, y: 0 };

function pixelRect(box: PdfFigureBox, source: PdfFigureSource): PixelRect | null {
  const { canvas } = source;
  const toX = (fraction: number) => ((fraction - source.left) / source.width) * canvas.width;
  const toY = (fraction: number) => ((fraction - source.top) / source.height) * canvas.height;
  const rect = {
    x: Math.max(0, Math.round(toX(box.left))),
    y: Math.max(0, Math.round(toY(box.top))),
    right: Math.min(canvas.width, Math.round(toX(box.right))),
    bottom: Math.min(canvas.height, Math.round(toY(box.bottom))),
  };
  return rect.right > rect.x && rect.bottom > rect.y ? rect : null;
}

function usable(source: PdfFigureSource): boolean {
  return source.canvas.width > 0 && source.canvas.height > 0 && source.width > 0 && source.height > 0;
}

function pixelReader(context: CanvasRenderingContext2D, rects: readonly PixelRect[], size: { width: number; height: number }): ReadPixels {
  const reach = EDGE_SEARCH_PX + 1;
  const left = Math.max(0, Math.min(...rects.map((rect) => rect.x)) - reach);
  const top = Math.max(0, Math.min(...rects.map((rect) => rect.y)) - reach);
  const right = Math.min(size.width, Math.max(...rects.map((rect) => rect.right)) + reach);
  const bottom = Math.min(size.height, Math.max(...rects.map((rect) => rect.bottom)) + reach);
  const across = right - left;
  const { data } = context.getImageData(left, top, across, bottom - top);
  return (x, y, width, height) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const from = ((y - top + row) * across + (x - left)) * 4;
      pixels.set(data.subarray(from, from + width * 4), row * width * 4);
    }
    return pixels;
  };
}

interface PageSample {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

function pageSample(canvas: HTMLCanvasElement): PageSample | null {
  const scale = Math.min(1, PROBE_LONGEST_SIDE_PX / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  try {
    const context = sample.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    return { data: context.getImageData(0, 0, sample.width, sample.height).data, width: sample.width, height: sample.height };
  } finally {
    sample.width = 0;
    sample.height = 0;
  }
}

const colorCounts = new Uint32Array(4096);

function colorBin(data: ArrayLike<number>, at: number): number {
  return ((data[at] >> 4) << 8) | ((data[at + 1] >> 4) << 4) | (data[at + 2] >> 4);
}

function samplePixels({ width, height }: PageSample, box: PdfFigureBox, onlyInside: boolean): number[] {
  const start = onlyInside ? Math.ceil : Math.floor;
  const end = onlyInside ? Math.floor : Math.ceil;
  const pixels: number[] = [];
  for (let y = start(box.top * height); y < end(box.bottom * height); y += 1) {
    for (let x = start(box.left * width); x < end(box.right * width); x += 1) pixels.push((y * width + x) * 4);
  }
  return pixels;
}

function scanLike(sample: PageSample, box: PdfFigureBox): boolean {
  const { data } = sample;
  const within = samplePixels(sample, box, true);
  const pixels = within.length >= SCAN_MIN_SAMPLES ? within : samplePixels(sample, box, false);
  const light = pixels.filter((at) => 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2] >= SCAN_PAPER_LIGHTNESS);
  if (light.length === 0) return false;
  let dominant = colorBin(data, light[0]);
  for (const at of light) {
    const bin = colorBin(data, at);
    colorCounts[bin] += 1;
    if (colorCounts[bin] > colorCounts[dominant]) dominant = bin;
  }
  const count = colorCounts[dominant];
  const sum = [0, 0, 0];
  for (const at of light) {
    const bin = colorBin(data, at);
    colorCounts[bin] = 0;
    if (bin !== dominant) continue;
    for (let channel = 0; channel < 3; channel += 1) sum[channel] += data[at + channel];
  }
  const [red, green, blue] = sum.map((total) => total / count);
  const near = pixels.filter(
    (at) =>
      Math.abs(data[at] - red) <= SCAN_PAPER_SPREAD &&
      Math.abs(data[at + 1] - green) <= SCAN_PAPER_SPREAD &&
      Math.abs(data[at + 2] - blue) <= SCAN_PAPER_SPREAD,
  ).length;
  return near >= pixels.length * SCAN_PAPER_SHARE;
}

function trimPdfFigures(boxes: readonly PdfFigureBox[], canvas: HTMLCanvasElement): PdfFigureBox[] {
  const source = { canvas, ...WHOLE_PAGE };
  if (boxes.length === 0 || !usable(source)) return [];
  const rects = boxes.map((box) => pixelRect(box, source)).filter((rect) => rect !== null);
  const context = rects.length > 0 ? canvas.getContext("2d") : null;
  const read = context ? pixelReader(context, rects, canvas) : null;
  const trimmed: PdfFigureBox[] = [];
  for (const rounded of rects) {
    const { x, y, right, bottom } = read ? trimPaperEdges(rounded, read, canvas) : rounded;
    if (right <= x || bottom <= y) continue;
    trimmed.push({ left: x / canvas.width, top: y / canvas.height, right: right / canvas.width, bottom: bottom / canvas.height });
  }
  return trimmed;
}

export function paintPdfFigures(
  boxes: readonly PdfFigureBox[],
  source: PdfFigureSource,
  after: Element,
  inset: { x: number; y: number } = NO_INSET,
): HTMLCanvasElement[] {
  if (!usable(source)) return [];
  const { canvas } = source;
  const rects: PixelRect[] = [];
  for (const box of boxes) {
    const rect = pixelRect(
      { left: box.left + inset.x, top: box.top + inset.y, right: box.right - inset.x, bottom: box.bottom - inset.y },
      source,
    );
    if (rect) rects.push(rect);
  }
  if (rects.length === 0) return [];
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const width = Math.max(...rects.map((rect) => rect.right)) - x;
  const height = Math.max(...rects.map((rect) => rect.bottom)) - y;
  const figure = document.createElement("canvas");
  const context = figure.getContext("2d");
  if (!context) return [];
  figure.className = PDF_FIGURE_CLASSES;
  figure.setAttribute("role", "presentation");
  figure.setAttribute("aria-hidden", "true");
  figure.width = width;
  figure.height = height;
  try {
    for (const rect of rects) {
      const across = rect.right - rect.x;
      const down = rect.bottom - rect.y;
      context.drawImage(canvas, rect.x, rect.y, across, down, rect.x - x, rect.y - y, across, down);
    }
  } catch (error) {
    figure.width = 0;
    figure.height = 0;
    throw error;
  }
  figure.style.left = percent(source.left + (x / canvas.width) * source.width);
  figure.style.top = percent(source.top + (y / canvas.height) * source.height);
  figure.style.width = percent((width / canvas.width) * source.width);
  figure.style.height = percent((height / canvas.height) * source.height);
  after.after(figure);
  return [figure];
}

function trimmedFor(page: object, viewport: PdfFigureViewport, canvas: HTMLCanvasElement): PdfFigureBox[] {
  const resolution = pixelsPerUnit(viewport, canvas);
  const kept = trimmedByPage.get(page);
  if (kept && kept.pixelsPerUnit >= resolution) return figureBoxes(kept.figures, viewport);
  const boxes = trimPdfFigures(shownBoxes(page, viewport, canvas), canvas);
  const figures = boxes.map((box) => inPdfSpace(box, viewport));
  if (resolution > 0 && figures.every((figure) => figure !== null)) {
    trimmedByPage.set(page, { figures: figures as PdfFigure[], pixelsPerUnit: resolution });
  }
  return boxes;
}

export function paintPdfPageFigures(page: object, viewport: PdfFigureViewport, canvas: HTMLCanvasElement): HTMLCanvasElement[] {
  if (!knowsPdfFigures(page)) return [];
  return paintPdfFigures(trimmedFor(page, viewport, canvas), { canvas, ...WHOLE_PAGE }, canvas);
}

export function paintPdfDetailFigures(
  page: object,
  viewport: PdfFigureViewport,
  source: PdfFigureSource,
  after: Element,
): HTMLCanvasElement[] {
  const kept = trimmedByPage.get(page);
  if (!kept) return paintPdfFigures(pdfFigureBoxes(page, viewport), source, after);
  const across = kept.pixelsPerUnit * pdfExtent(viewport, viewport.width, 0);
  const down = kept.pixelsPerUnit * pdfExtent(viewport, 0, viewport.height);
  const inset = { x: across > 0 ? 1 / across : 0, y: down > 0 ? 1 / down : 0 };
  return paintPdfFigures(figureBoxes(kept.figures, viewport), source, after, inset);
}
