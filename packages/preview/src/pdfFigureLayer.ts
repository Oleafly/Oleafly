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

const figuresByPage = new WeakMap<object, readonly PdfFigure[]>();

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

export function pdfFigureBoxes(page: object, viewport: PdfFigureViewport): PdfFigureBox[] {
  const figures = figuresByPage.get(page);
  const toViewport = viewport.convertToViewportPoint;
  if (!figures || !toViewport || viewport.width <= 0 || viewport.height <= 0) return [];
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
    coverage += (box.right - box.left) * (box.bottom - box.top);
    boxes.push(box);
  }
  return coverage >= SCANNED_PAGE_COVERAGE ? [] : boxes;
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

export function paintPdfFigures(
  boxes: readonly PdfFigureBox[],
  source: PdfFigureSource,
  after: Element,
): HTMLCanvasElement[] {
  const { canvas } = source;
  if (canvas.width <= 0 || canvas.height <= 0 || source.width <= 0 || source.height <= 0) return [];
  const sourceContext = canvas.getContext("2d");
  const read: ReadPixels | null = sourceContext
    ? (x, y, width, height) => sourceContext.getImageData(x, y, width, height).data
    : null;
  const painted: HTMLCanvasElement[] = [];
  for (const box of boxes) {
    const toX = (fraction: number) => ((fraction - source.left) / source.width) * canvas.width;
    const toY = (fraction: number) => ((fraction - source.top) / source.height) * canvas.height;
    const rounded = {
      x: Math.max(0, Math.round(toX(box.left))),
      y: Math.max(0, Math.round(toY(box.top))),
      right: Math.min(canvas.width, Math.round(toX(box.right))),
      bottom: Math.min(canvas.height, Math.round(toY(box.bottom))),
    };
    if (rounded.right <= rounded.x || rounded.bottom <= rounded.y) continue;
    const { x, y, right, bottom } = read ? trimPaperEdges(rounded, read, canvas) : rounded;
    const width = right - x;
    const height = bottom - y;
    if (width <= 0 || height <= 0) continue;
    const figure = document.createElement("canvas");
    const context = figure.getContext("2d");
    if (!context) continue;
    figure.className = PDF_FIGURE_CLASSES;
    figure.setAttribute("role", "presentation");
    figure.setAttribute("aria-hidden", "true");
    figure.width = width;
    figure.height = height;
    context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    figure.style.left = percent(source.left + (x / canvas.width) * source.width);
    figure.style.top = percent(source.top + (y / canvas.height) * source.height);
    figure.style.width = percent((width / canvas.width) * source.width);
    figure.style.height = percent((height / canvas.height) * source.height);
    painted.push(figure);
  }
  after.after(...painted);
  return painted;
}
