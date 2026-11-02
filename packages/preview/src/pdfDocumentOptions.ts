import type { getDocument } from "pdfjs-dist";
import { isWebKit } from "./worker-decompression";

type PdfDocumentParams = NonNullable<Parameters<typeof getDocument>[0]>;

export const PDFJS_STANDARD_FONTS_PATH = "pdfjs/standard_fonts/";
export const PDFJS_WASM_PATH = "pdfjs/wasm/";
export const PDFJS_CMAPS_PATH = "pdfjs/cmaps/";
export const PDFJS_ICCS_PATH = "pdfjs/iccs/";

type SharedPdfDocumentOptions = {
  standardFontDataUrl: string;
  wasmUrl: string;
  cMapUrl: string;
  cMapPacked: true;
  iccUrl: string;
  useWorkerFetch: true;
  disableFontFace?: true;
};

function appUrl(path: string, base: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}${path}`;
}

export function pdfjsStandardFontDataUrl(base: string = import.meta.env.BASE_URL): string {
  return appUrl(PDFJS_STANDARD_FONTS_PATH, base);
}

export function pdfjsWasmUrl(base: string = import.meta.env.BASE_URL): string {
  return appUrl(PDFJS_WASM_PATH, base);
}

export function pdfjsCMapUrl(base: string = import.meta.env.BASE_URL): string {
  return appUrl(PDFJS_CMAPS_PATH, base);
}

export function pdfjsIccUrl(base: string = import.meta.env.BASE_URL): string {
  return appUrl(PDFJS_ICCS_PATH, base);
}

// WebKitGTK draws text from a loaded FontFace into a 2D canvas with the
// desktop's font smoothing. When the desktop asks for subpixel smoothing, every
// glyph on the page gets orange and blue edges. Glyphs drawn as paths stay
// grayscale. Other engines keep canvas text grayscale, so they keep FontFace,
// which renders pages faster.
export function smoothsCanvasTextLikeTheDesktop(userAgent: string): boolean {
  return /\bLinux\b/.test(userAgent) && isWebKit(userAgent);
}

export function sharedPdfDocumentOptions(
  base: string = import.meta.env.BASE_URL,
  userAgent: string = globalThis.navigator?.userAgent ?? "",
): SharedPdfDocumentOptions {
  return {
    standardFontDataUrl: pdfjsStandardFontDataUrl(base),
    wasmUrl: pdfjsWasmUrl(base),
    cMapUrl: pdfjsCMapUrl(base),
    cMapPacked: true,
    iccUrl: pdfjsIccUrl(base),
    useWorkerFetch: true,
    ...(smoothsCanvasTextLikeTheDesktop(userAgent) ? { disableFontFace: true as const } : {}),
  };
}

export function pdfDocumentOptions<T extends PdfDocumentParams>(params: T): T & SharedPdfDocumentOptions {
  return { ...sharedPdfDocumentOptions(), ...params };
}
