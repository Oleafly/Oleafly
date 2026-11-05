import { afterEach, describe, expect, it, vi } from "vitest";
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
  smoothsCanvasTextLikeTheDesktop,
} from "./pdfDocumentOptions";

const WEBKITGTK = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WEBKITGTK_ARM = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const MAC_WEBVIEW = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WEBVIEW2 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";

describe("pdf.js document options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("draw glyphs as paths in WebKitGTK only, so subpixel font smoothing can't put colour fringes on PDF text", () => {
    expect(smoothsCanvasTextLikeTheDesktop(WEBKITGTK)).toBe(true);
    expect(smoothsCanvasTextLikeTheDesktop(WEBKITGTK_ARM)).toBe(true);
    for (const ua of [MAC_WEBVIEW, WEBVIEW2, CHROME_LINUX, FIREFOX_LINUX, ""]) {
      expect(smoothsCanvasTextLikeTheDesktop(ua)).toBe(false);
    }
    expect(sharedPdfDocumentOptions("/", WEBKITGTK).disableFontFace).toBe(true);
    expect(sharedPdfDocumentOptions("/", MAC_WEBVIEW)).not.toHaveProperty("disableFontFace");
    expect(sharedPdfDocumentOptions("/", WEBVIEW2)).not.toHaveProperty("disableFontFace");
  });

  it("read the running webview's user agent, so every pdf.js load in the Linux app gets it", () => {
    vi.spyOn(globalThis.navigator, "userAgent", "get").mockReturnValue(WEBKITGTK);
    expect(sharedPdfDocumentOptions()).toMatchObject({ disableFontFace: true, useWorkerFetch: true });
    expect(pdfDocumentOptions({ data: new Uint8Array([1]) }).disableFontFace).toBe(true);
  });
});
