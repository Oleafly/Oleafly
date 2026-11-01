import type { getDocument } from "pdfjs-dist";

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

export function sharedPdfDocumentOptions(base: string = import.meta.env.BASE_URL): SharedPdfDocumentOptions {
  return {
    standardFontDataUrl: pdfjsStandardFontDataUrl(base),
    wasmUrl: pdfjsWasmUrl(base),
    cMapUrl: pdfjsCMapUrl(base),
    cMapPacked: true,
    iccUrl: pdfjsIccUrl(base),
    useWorkerFetch: true,
  };
}

export function pdfDocumentOptions<T extends PdfDocumentParams>(params: T): T & SharedPdfDocumentOptions {
  return { ...sharedPdfDocumentOptions(), ...params };
}
