import { describe, expect, it } from "vitest";
import {
  PDFJS_CMAPS_PATH,
  PDFJS_ICCS_PATH,
  PDFJS_STANDARD_FONTS_PATH,
  PDFJS_WASM_PATH,
  pdfDocumentOptions,
  pdfjsCMapUrl,
  pdfjsIccUrl,
  pdfjsStandardFontDataUrl,
  pdfjsWasmUrl,
  sharedPdfDocumentOptions,
} from "./pdfDocumentOptions";

describe("pdf.js document options", () => {
  it("point pdf.js at the files the app serves, with the trailing slash pdf.js requires", () => {
    expect([PDFJS_STANDARD_FONTS_PATH, PDFJS_WASM_PATH, PDFJS_CMAPS_PATH, PDFJS_ICCS_PATH]).toEqual([
      "pdfjs/standard_fonts/",
      "pdfjs/wasm/",
      "pdfjs/cmaps/",
      "pdfjs/iccs/",
    ]);
    const base = import.meta.env.BASE_URL;
    expect(sharedPdfDocumentOptions()).toEqual({
      standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
      wasmUrl: `${base}pdfjs/wasm/`,
      cMapUrl: `${base}pdfjs/cmaps/`,
      cMapPacked: true,
      iccUrl: `${base}pdfjs/iccs/`,
      useWorkerFetch: true,
    });
  });

  it("keep the app's base path, so the browser app under /web/ finds them too", () => {
    expect(pdfjsStandardFontDataUrl("/")).toBe("/pdfjs/standard_fonts/");
    expect(pdfjsStandardFontDataUrl("/web/")).toBe("/web/pdfjs/standard_fonts/");
    expect(pdfjsStandardFontDataUrl("/web")).toBe("/web/pdfjs/standard_fonts/");
    expect(pdfjsWasmUrl("/web/")).toBe("/web/pdfjs/wasm/");
    expect(pdfjsCMapUrl("/web/")).toBe("/web/pdfjs/cmaps/");
    expect(pdfjsIccUrl("/web/")).toBe("/web/pdfjs/iccs/");
    expect(sharedPdfDocumentOptions("/web/")).toMatchObject({ cMapUrl: "/web/pdfjs/cmaps/", useWorkerFetch: true });
  });

  it("keep each call site's own options beside the shared ones", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(pdfDocumentOptions({ data, password: "secret" })).toEqual({
      ...sharedPdfDocumentOptions(),
      data,
      password: "secret",
    });
    expect(pdfDocumentOptions({ data }).data).toBe(data);
  });
});
