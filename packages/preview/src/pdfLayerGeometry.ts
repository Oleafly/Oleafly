export interface PdfLayerViewport {
  width: number;
  height: number;
  scale: number;
  userUnit: number;
  rotation: number;
}

export interface PdfLayerGeometry {
  cssWidth: string;
  cssHeight: string;
  cssWidthPx: number;
  cssHeightPx: number;
  canvasWidth: number;
  canvasHeight: number;
  outputScaleX: number;
  outputScaleY: number;
  scaleRoundX: number;
  scaleRoundY: number;
  restrictedScaling: boolean;
}

// Desktop WebKit can reject or silently blank oversized canvas backing stores.
// This source-aligned cap uses pdf.js' mobile compatibility area and a
// conservative cross-engine dimension while leaving the CSS/text/annotation
// viewport at its exact size.
export const MAX_PDF_CANVAS_PIXELS = 5_242_880;
export const MAX_PDF_CANVAS_DIMENSION = 16_384;

let cssRoundSupported: boolean | undefined;

// pdf.js 6.1.200 uses CSS round() when the current engine implements it with
// the expected precision, and Math.fround for the matching canvas calculation.
// Keep the feature test byte-for-byte equivalent to pdf_viewer.mjs.
export function supportsPdfCssRound(): boolean {
  if (cssRoundSupported !== undefined) return cssRoundSupported;
  const element = document.createElement("div");
  element.style.width = "round(down, calc(1.6666666666666665 * 792px), 1px)";
  cssRoundSupported = element.style.width === "calc(1320px)";
  return cssRoundSupported;
}

// This is the installed pdf.js 6.1.200 `approximateFraction` algorithm. The
// denominator is also the CSS `--scale-round-*` quantum.
export function approximatePdfFraction(value: number): [number, number] {
  if (Math.floor(value) === value) return [value, 1];
  const inverse = 1 / value;
  const limit = 8;
  if (inverse > limit) return [1, limit];
  if (Math.floor(inverse) === inverse) return [1, inverse];

  const target = value > 1 ? inverse : value;
  let a = 0;
  let b = 1;
  let c = 1;
  let d = 1;
  while (true) {
    const numerator = a + c;
    const denominator = b + d;
    if (denominator > limit) break;
    if (target <= numerator / denominator) {
      c = numerator;
      d = denominator;
    } else {
      a = numerator;
      b = denominator;
    }
  }
  if (target - a / b < c / d - target) {
    return target === value ? [a, b] : [b, a];
  }
  return target === value ? [c, d] : [d, c];
}

function floorToDivide(value: number, divisor: number): number {
  return value - (value % divisor);
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Match PDFPageView.draw's output-scale rounding for our custom canvas path.
 *
 * Canvas pixels are rounded down to a multiple of the DPR fraction numerator,
 * while the CSS page size is rounded down to a multiple of its denominator.
 * This makes the adjusted render transform and the selectable text layer share
 * exactly the same CSS box, including fractional DPR displays.
 */
export function pdfLayerGeometry(
  viewport: PdfLayerViewport,
  devicePixelRatio: number,
  useCssRound = supportsPdfCssRound(),
  maxCanvasPixels = MAX_PDF_CANVAS_PIXELS,
  maxCanvasDimension = MAX_PDF_CANVAS_DIMENSION,
): PdfLayerGeometry {
  const width = positiveOr(viewport.width, 1);
  const height = positiveOr(viewport.height, 1);
  const requestedOutputScale = positiveOr(devicePixelRatio, 1);
  const areaScale =
    maxCanvasPixels > 0
      ? Math.sqrt(maxCanvasPixels / (width * height))
      : Number.POSITIVE_INFINITY;
  const widthScale =
    maxCanvasDimension > 0
      ? maxCanvasDimension / width
      : Number.POSITIVE_INFINITY;
  const heightScale =
    maxCanvasDimension > 0
      ? maxCanvasDimension / height
      : Number.POSITIVE_INFINITY;
  const outputScale = Math.min(
    requestedOutputScale,
    areaScale,
    widthScale,
    heightScale,
  );
  const restrictedScaling = outputScale < requestedOutputScale;
  const [scaleNumeratorX, scaleDenominatorX] = approximatePdfFraction(outputScale);
  const [scaleNumeratorY, scaleDenominatorY] = approximatePdfFraction(outputScale);
  const round = useCssRound ? Math.fround : (value: number) => value;

  const canvasWidth = Math.max(1, floorToDivide(
    round(width * outputScale),
    scaleNumeratorX,
  ));
  const canvasHeight = Math.max(1, floorToDivide(
    round(height * outputScale),
    scaleNumeratorY,
  ));
  const cssWidthPx = Math.max(1, floorToDivide(round(width), scaleDenominatorX));
  const cssHeightPx = Math.max(1, floorToDivide(round(height), scaleDenominatorY));

  return {
    cssWidth: `${cssWidthPx}px`,
    cssHeight: `${cssHeightPx}px`,
    cssWidthPx,
    cssHeightPx,
    canvasWidth,
    canvasHeight,
    outputScaleX: canvasWidth / cssWidthPx,
    outputScaleY: canvasHeight / cssHeightPx,
    scaleRoundX: scaleDenominatorX,
    scaleRoundY: scaleDenominatorY,
    restrictedScaling,
  };
}

export function applyPdfLayerViewport(
  element: HTMLElement,
  viewport: PdfLayerViewport,
  devicePixelRatio: number,
): PdfLayerGeometry {
  const safeScale = positiveOr(viewport.scale, 1);
  const safeUserUnit = positiveOr(viewport.userUnit, 1);
  const geometry = pdfLayerGeometry(viewport, devicePixelRatio);

  element.style.setProperty("--scale-factor", String(safeScale));
  element.style.setProperty("--user-unit", String(safeUserUnit));
  element.style.setProperty(
    "--total-scale-factor",
    "calc(var(--scale-factor) * var(--user-unit))",
  );
  element.style.setProperty("--scale-round-x", `${geometry.scaleRoundX}px`);
  element.style.setProperty("--scale-round-y", `${geometry.scaleRoundY}px`);
  element.style.width = geometry.cssWidth;
  element.style.height = geometry.cssHeight;
  return geometry;
}

export function applyPdfPlaceholderViewport(
  element: HTMLElement,
  viewportAtScaleOne: PdfLayerViewport,
  scale: number,
  devicePixelRatio: number,
): void {
  const safeScale = positiveOr(scale, 1);
  applyPdfLayerViewport(
    element,
    {
      width: positiveOr(viewportAtScaleOne.width, 1) * safeScale,
      height: positiveOr(viewportAtScaleOne.height, 1) * safeScale,
      scale: safeScale,
      userUnit: positiveOr(viewportAtScaleOne.userUnit, 1),
      rotation: viewportAtScaleOne.rotation,
    },
    devicePixelRatio,
  );
}

/**
 * Visit at most `limit` placeholders. Call again on the next animation frame
 * when this returns false, keeping zoom work bounded for long documents.
 */
export function visitPdfPlaceholderBatch<T>(
  iterator: Iterator<T>,
  limit: number,
  visit: (value: T) => void,
): boolean {
  const safeLimit = Math.max(1, Math.floor(limit));
  for (let count = 0; count < safeLimit; count++) {
    const next = iterator.next();
    if (next.done) return true;
    visit(next.value);
  }
  return false;
}

/**
 * Release raster backing stores before detaching their DOM nodes. Keeping a
 * stale canvas reference must not keep its potentially multi-megabyte pixel
 * allocation alive after eviction, cancellation, or document switch.
 */
export function releasePdfRenderNodes(nodes: HTMLElement[]): void {
  for (const node of nodes) {
    if (node instanceof HTMLCanvasElement) {
      node.width = 0;
      node.height = 0;
    }
    node.remove();
  }
  nodes.length = 0;
}
