type PdfPoint = readonly [number, number];
type PdfFigure = readonly [PdfPoint, PdfPoint, PdfPoint];

interface PdfFigureViewport {
  width: number;
  height: number;
  convertToPdfPoint?: (x: number, y: number) => number[];
  convertToViewportPoint?: (x: number, y: number) => number[];
}

interface PdfFigurePage {
  imageCoordinates?: ArrayLike<number> | null;
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

const PDF_FIGURE_CLASSES = `pdf-figure pointer-events-none absolute z-[2] hidden group-data-[pdf-colors]/pdf:block`;

const SCANNED_PAGE_COVERAGE = 0.8;

const PROBE_LONGEST_SIDE_PX = 256;

export const MAX_PDF_FIGURES_PER_PAGE = 32;

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
  const coordinates = page.imageCoordinates;
  const toPdf = recordedWith.convertToPdfPoint;
  if (!coordinates || !toPdf) return false;
  const point = (at: number): PdfPoint => {
    const [x, y] = toPdf.call(
      recordedWith,
      coordinates[at] * canvasInViewportUnits.width,
      coordinates[at + 1] * canvasInViewportUnits.height,
    );
    return [x, y];
  };
  const figures: PdfFigure[] = [];
  for (let at = 0; at + 5 < coordinates.length; at += 6) {
    figures.push([point(at), point(at + 2), point(at + 4)]);
  }
  figuresByPage.set(page, figures);
  return true;
}

function figureBoxes(figures: readonly PdfFigure[], viewport: PdfFigureViewport): PdfFigureBox[] | null {
  const toViewport = viewport.convertToViewportPoint;
  if (!toViewport || viewport.width <= 0 || viewport.height <= 0) return null;
  const boxes: PdfFigureBox[] = [];
  let coverage = 0;
  for (const figure of figures) {
    const [a, b, c] = figure.map(([x, y]) => toViewport.call(viewport, x, y));
    const xs = [a[0], b[0], c[0], b[0] + c[0] - a[0]].map((x) => x / viewport.width);
    const ys = [a[1], b[1], c[1], b[1] + c[1] - a[1]].map((y) => y / viewport.height);
    const box = {
      left: Math.max(0, Math.min(...xs)),
      top: Math.max(0, Math.min(...ys)),
      right: Math.min(1, Math.max(...xs)),
      bottom: Math.min(1, Math.max(...ys)),
    };
    if (box.right <= box.left || box.bottom <= box.top) continue;
    if (boxes.length === MAX_PDF_FIGURES_PER_PAGE) return null;
    coverage += (box.right - box.left) * (box.bottom - box.top);
    boxes.push(box);
  }
  return coverage >= SCANNED_PAGE_COVERAGE ? null : boxes;
}

export function pdfFigureBoxes(page: object, viewport: PdfFigureViewport): PdfFigureBox[] {
  const figures = figuresByPage.get(page);
  return (figures && figureBoxes(figures, viewport)) ?? [];
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

function firstInkColumn(read: ReadPixels, from: number, to: number, y: number, height: number, step: 1 | -1): number | null {
  const start = Math.min(from, to);
  const width = Math.abs(to - from);
  if (width <= 0 || height <= 0) return null;
  const pixels = read(start, y, width, height);
  for (let column = step === 1 ? 0 : width - 1; column >= 0 && column < width; column += step) {
    for (let row = 0; row < height; row += 1) {
      if (inkAt(pixels, (row * width + column) * 4)) return start + column;
    }
  }
  return null;
}

function firstInkRow(read: ReadPixels, from: number, to: number, x: number, width: number, step: 1 | -1): number | null {
  const start = Math.min(from, to);
  const height = Math.abs(to - from);
  if (width <= 0 || height <= 0) return null;
  const pixels = read(x, start, width, height);
  for (let row = step === 1 ? 0 : height - 1; row >= 0 && row < height; row += step) {
    for (let column = 0; column < width; column += 1) {
      if (inkAt(pixels, (row * width + column) * 4)) return start + row;
    }
  }
  return null;
}

export function trimPaperEdges(rect: PixelRect, read: ReadPixels, size: { width: number; height: number }): PixelRect {
  const reach = EDGE_SEARCH_PX;
  const leftFrom = Math.max(0, rect.x - reach);
  const leftTo = Math.min(rect.right, rect.x + reach + 1);
  const x = firstInkColumn(read, leftFrom, leftTo, rect.y, rect.bottom - rect.y, 1) ?? leftTo;
  const rightFrom = Math.max(x, rect.right - reach - 1);
  const rightTo = Math.min(size.width, rect.right + reach);
  const lastColumn = firstInkColumn(read, rightFrom, rightTo, rect.y, rect.bottom - rect.y, -1);
  const right = lastColumn === null ? rightFrom : lastColumn + 1;
  const topFrom = Math.max(0, rect.y - reach);
  const topTo = Math.min(rect.bottom, rect.y + reach + 1);
  const y = firstInkRow(read, topFrom, topTo, x, right - x, 1) ?? topTo;
  const bottomFrom = Math.max(y, rect.bottom - reach - 1);
  const bottomTo = Math.min(size.height, rect.bottom + reach);
  const lastRow = firstInkRow(read, bottomFrom, bottomTo, x, right - x, -1);
  const bottom = lastRow === null ? bottomFrom : lastRow + 1;
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

function trimPdfFigures(boxes: readonly PdfFigureBox[], canvas: HTMLCanvasElement): PdfFigureBox[] {
  const source = { canvas, ...WHOLE_PAGE };
  if (boxes.length === 0 || !usable(source)) return [];
  const context = canvas.getContext("2d");
  const read: ReadPixels | null = context ? (x, y, width, height) => context.getImageData(x, y, width, height).data : null;
  const trimmed: PdfFigureBox[] = [];
  for (const box of boxes) {
    const rounded = pixelRect(box, source);
    if (!rounded) continue;
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
  for (const rect of rects) {
    const across = rect.right - rect.x;
    const down = rect.bottom - rect.y;
    context.drawImage(canvas, rect.x, rect.y, across, down, rect.x - x, rect.y - y, across, down);
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
  if (kept && kept.pixelsPerUnit >= resolution) return figureBoxes(kept.figures, viewport) ?? [];
  const boxes = trimPdfFigures(pdfFigureBoxes(page, viewport), canvas);
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
  return paintPdfFigures(figureBoxes(kept.figures, viewport) ?? [], source, after, inset);
}
