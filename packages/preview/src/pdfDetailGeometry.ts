import {
  approximatePdfFraction,
  MAX_PDF_CANVAS_DIMENSION,
  MAX_PDF_CANVAS_PIXELS,
} from "./pdfLayerGeometry";

export interface PdfRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PdfVisibleArea {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PdfDetailArea {
  minX: number;
  minY: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  outputScale: number;
}

export const MAX_PDF_DETAIL_PIXELS = 4 * MAX_PDF_CANVAS_PIXELS;

const MAX_DEVICE_PIXEL_DENOMINATOR = 32;
const MOVEMENT_THRESHOLD = 0.5;

function floorToDivide(value: number, divisor: number): number {
  return value - (value % divisor);
}

function ceilToDivide(value: number, divisor: number): number {
  const remainder = value % divisor;
  return remainder === 0 ? value : value - remainder + divisor;
}

export function pdfDevicePixelFraction(devicePixelRatio: number): [number, number] {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  for (let denominator = 1; denominator <= MAX_DEVICE_PIXEL_DENOMINATOR; denominator++) {
    const numerator = ratio * denominator;
    const rounded = Math.round(numerator);
    if (rounded > 0 && Math.abs(numerator - rounded) < 1e-6) {
      return [rounded, denominator];
    }
  }
  return approximatePdfFraction(ratio);
}

export function pdfVisibleArea(
  pageRect: PdfRectLike,
  viewportRect: PdfRectLike,
): PdfVisibleArea | null {
  const minX = Math.max(0, viewportRect.left - pageRect.left);
  const minY = Math.max(0, viewportRect.top - pageRect.top);
  const maxX = Math.min(pageRect.right, viewportRect.right) - pageRect.left;
  const maxY = Math.min(pageRect.bottom, viewportRect.bottom) - pageRect.top;
  if (!(maxX > minX) || !(maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function pdfDetailArea(
  visible: PdfVisibleArea,
  pageWidth: number,
  pageHeight: number,
  devicePixelRatio: number,
  maxCanvasPixels = MAX_PDF_CANVAS_PIXELS,
  maxCanvasDimension = MAX_PDF_CANVAS_DIMENSION,
  maxDetailPixels = MAX_PDF_DETAIL_PIXELS,
): PdfDetailArea | null {
  const visibleWidth = visible.maxX - visible.minX;
  const visibleHeight = visible.maxY - visible.minY;
  if (!(visibleWidth > 0) || !(visibleHeight > 0)) return null;

  const requestedScale =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const requestedPixels = visibleWidth * visibleHeight * requestedScale * requestedScale;
  const [numerator, denominator] =
    maxDetailPixels > 0 && requestedPixels > maxDetailPixels
      ? approximatePdfFraction(
          requestedScale * Math.sqrt(maxDetailPixels / requestedPixels),
        )
      : pdfDevicePixelFraction(requestedScale);
  const outputScale = numerator / denominator;

  const visiblePixels = visibleWidth * visibleHeight * outputScale * outputScale;
  const budget = maxCanvasPixels > 0 ? maxCanvasPixels : Number.POSITIVE_INFINITY;
  const linearRatio = Math.sqrt(budget / visiblePixels);
  const overflowScale = Math.max(0, Math.min(1, (linearRatio - 1) / 2));
  const overflowWidth = visibleWidth * overflowScale;
  const overflowHeight = visibleHeight * overflowScale;

  const maxWidth = floorToDivide(Math.floor(pageWidth), denominator);
  const maxHeight = floorToDivide(Math.floor(pageHeight), denominator);
  const minX = floorToDivide(Math.max(0, Math.floor(visible.minX - overflowWidth)), denominator);
  const minY = floorToDivide(Math.max(0, Math.floor(visible.minY - overflowHeight)), denominator);
  const maxX = Math.min(maxWidth, ceilToDivide(Math.ceil(visible.maxX + overflowWidth), denominator));
  const maxY = Math.min(maxHeight, ceilToDivide(Math.ceil(visible.maxY + overflowHeight), denominator));

  const dimensionLimit =
    maxCanvasDimension > 0
      ? floorToDivide(Math.floor(maxCanvasDimension / outputScale), denominator)
      : Number.POSITIVE_INFINITY;
  const width = Math.min(maxX - minX, dimensionLimit);
  const height = Math.min(maxY - minY, dimensionLimit);
  if (!(width > 0) || !(height > 0)) return null;

  return {
    minX,
    minY,
    width,
    height,
    canvasWidth: (width / denominator) * numerator,
    canvasHeight: (height / denominator) * numerator,
    outputScale,
  };
}

export function pdfDetailAreaCovers(
  area: PdfDetailArea,
  visible: PdfVisibleArea,
  pageWidth: number,
  pageHeight: number,
): boolean {
  const maxDetailX = area.minX + area.width;
  const maxDetailY = area.minY + area.height;
  if (
    visible.minX < area.minX ||
    visible.minY < area.minY ||
    visible.maxX > maxDetailX ||
    visible.maxY > maxDetailY
  ) {
    return false;
  }
  const paddingLeft = visible.minX - area.minX;
  const paddingRight = maxDetailX - visible.maxX;
  const paddingTop = visible.minY - area.minY;
  const paddingBottom = maxDetailY - visible.maxY;
  const ratio = (1 + MOVEMENT_THRESHOLD) / MOVEMENT_THRESHOLD;
  if (
    (area.minX > 0 && paddingRight / paddingLeft > ratio) ||
    (maxDetailX < pageWidth && paddingLeft / paddingRight > ratio) ||
    (area.minY > 0 && paddingBottom / paddingTop > ratio) ||
    (maxDetailY < pageHeight && paddingTop / paddingBottom > ratio)
  ) {
    return false;
  }
  return true;
}

export function pdfDetailTransform(area: PdfDetailArea): number[] {
  const { outputScale } = area;
  return [
    outputScale,
    0,
    0,
    outputScale,
    0 - area.minX * outputScale,
    0 - area.minY * outputScale,
  ];
}
