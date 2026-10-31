import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LAZY_NAMESPACES, NAMESPACES } from "@/i18n/resources";
import {
  PDFJS_CMAPS_PATH,
  PDFJS_ICCS_PATH,
  PDFJS_STANDARD_FONTS_PATH,
  PDFJS_WASM_PATH,
  pdfjsCMapUrl,
  pdfjsStandardFontDataUrl,
  pdfjsWasmUrl,
} from "@oleafly/preview/pdfDocumentOptions";
import desktopConfig, {
  entriesLoadingBeforePolyfills,
  LEGAL_COMMENT_PATTERN,
  localeChunk,
  PDFJS_DIST_DIR,
  pdfjsAssetFiles,
  pdfjsAssets,
  POLYFILLS_CHUNK,
  polyfillsChunk,
} from "../../vite.config";
import webConfig from "../../vite.web.config";

describe("translated catalog chunks", () => {
  it.each(["ru", "pt-BR", "zh-Hans"])("give %s one startup chunk and one chunk per lazy namespace", (locale) => {
    for (const namespace of NAMESPACES) {
      const expected = LAZY_NAMESPACES.includes(namespace) ? `locale-${locale}-${namespace}` : `locale-${locale}`;
      expect(localeChunk(`/repo/src/i18n/locales/${locale}/${namespace}.json`), namespace).toBe(expected);
    }
  });

  it("leave English catalogs and other modules to the default chunking", () => {
    expect(localeChunk("/repo/src/i18n/locales/en/collab.json")).toBeUndefined();
    expect(localeChunk("/repo/src/i18n/locales/en/shell.json")).toBeUndefined();
    expect(localeChunk("/repo/src/features/collab/store.ts")).toBeUndefined();
  });
});

describe("runtime polyfill chunk", () => {
  const chunk = (fileName: string, name: string, imports: string[] = [], isEntry = false) => ({
    type: "chunk",
    fileName,
    name,
    imports,
    isEntry,
  });

  it("gives the runtime polyfills a chunk of their own", () => {
    expect(polyfillsChunk("/repo/packages/preview/src/polyfills.ts")).toBe(POLYFILLS_CHUNK);
    expect(polyfillsChunk("/repo/packages/preview/src/polyfills.test.ts")).toBeUndefined();
    expect(polyfillsChunk("/repo/packages/preview/src/pdf.worker.ts")).toBeUndefined();
  });

  it("accepts an entry whose first import is the polyfills", () => {
    expect(
      entriesLoadingBeforePolyfills([
        chunk("assets/index-a.js", "index", ["assets/polyfills-b.js", "assets/pdfjs-lib-c.js"], true),
        chunk("assets/polyfills-b.js", "polyfills"),
        chunk("assets/pdfjs-lib-c.js", "pdfjs-lib"),
      ]),
    ).toEqual([]);
  });

  it("flags an entry that loads a library chunk before the polyfills", () => {
    expect(
      entriesLoadingBeforePolyfills([
        chunk("assets/index-a.js", "index", ["assets/pdfjs-lib-c.js", "assets/polyfills-b.js"], true),
        chunk("assets/polyfills-b.js", "polyfills"),
        chunk("assets/pdfjs-lib-c.js", "pdfjs-lib"),
      ]),
    ).toEqual(["assets/index-a.js"]);
  });

  it("flags the entry when the polyfills were folded into another chunk", () => {
    expect(entriesLoadingBeforePolyfills([chunk("assets/index-a.js", "index", [], true)])).toEqual([
      "assets/index-a.js",
    ]);
  });
});

describe("production legal-comment retention", () => {
  it.each([
    "! MIT License",
    "@license Apache-2.0",
    "Copyright Example\n@preserve",
    "@cc_on",
  ])("retains %j", (comment) => {
    expect(LEGAL_COMMENT_PATTERN.test(comment)).toBe(true);
  });

  it.each([
    "ordinary implementation note",
    "TODO: remove this",
    "source map hint",
  ])("continues to remove %j", (comment) => {
    expect(LEGAL_COMMENT_PATTERN.test(comment)).toBe(false);
  });
});

describe("pdf.js standard fonts and wasm decoders", () => {
  type Emitted = { type: string; fileName: string; source: Uint8Array };
  type Middleware = (
    request: { url?: string },
    response: { setHeader: (name: string, value: string) => void; end: (body: Uint8Array) => void },
    next: () => void,
  ) => void;

  const distBytes = (folder: string, name: string) => readFileSync(path.join(PDFJS_DIST_DIR, folder, name));

  const emitted = () => {
    const files: Emitted[] = [];
    const generateBundle = pdfjsAssets().generateBundle as unknown as (this: unknown) => void;
    generateBundle.call({ emitFile: (file: Emitted) => files.push(file) });
    return files;
  };

  const devServer = (base: string) => {
    let middleware: Middleware | undefined;
    const configureServer = pdfjsAssets().configureServer as unknown as (server: unknown) => void;
    configureServer({ config: { base }, middlewares: { use: (handler: Middleware) => (middleware = handler) } });
    return (url: string) => {
      const next = vi.fn();
      const headers = new Map<string, string>();
      let body: Uint8Array | undefined;
      middleware?.(
        { url },
        { setHeader: (name, value) => headers.set(name, value), end: (bytes) => (body = bytes) },
        next,
      );
      return { body, next, type: headers.get("Content-Type") };
    };
  };

  const pluginNames = (plugins: unknown[] | undefined) =>
    (plugins ?? []).flat(Infinity).map((plugin) => (plugin as { name?: string } | null)?.name);

  it("include the Symbol and ZapfDingbats data, the Liberation fallbacks and their licenses", () => {
    expect([...pdfjsAssetFiles().keys()]).toEqual(
      expect.arrayContaining(
        ["FoxitSymbol.pfb", "FoxitDingbats.pfb", "LiberationSans-Regular.ttf", "LICENSE_FOXIT", "LICENSE_LIBERATION"].map(
          (name) => `pdfjs/standard_fonts/${name}`,
        ),
      ),
    );
  });

  it("include the JPEG 2000, JBIG2 and ICC decoders with their fallbacks and licenses, and leave out the scripting engine", () => {
    const names = [...pdfjsAssetFiles().keys()];
    expect(names).toEqual(
      expect.arrayContaining(
        [
          "openjpeg.wasm",
          "openjpeg_nowasm_fallback.js",
          "jbig2.wasm",
          "jbig2_nowasm_fallback.js",
          "qcms_bg.wasm",
          "LICENSE_OPENJPEG",
          "LICENSE_PDFJS_OPENJPEG",
          "LICENSE_JBIG2",
          "LICENSE_PDFJS_JBIG2",
          "LICENSE_QCMS",
          "LICENSE_PDFJS_QCMS",
        ].map((name) => `pdfjs/wasm/${name}`),
      ),
    );
    expect(names.filter((name) => name.includes("quickjs"))).toEqual([]);
  });

  it("include every packed CMap pdf.js knows and the CMYK ICC profile, with their licenses", () => {
    const names = [...pdfjsAssetFiles().keys()];
    const shippedCMaps = readdirSync(path.join(PDFJS_DIST_DIR, "cmaps")).filter((name) => name.endsWith(".bcmap"));
    expect(shippedCMaps.length).toBeGreaterThan(150);
    expect(names).toEqual(
      expect.arrayContaining([
        ...shippedCMaps.map((name) => `${PDFJS_CMAPS_PATH}${name}`),
        `${PDFJS_CMAPS_PATH}LICENSE`,
        `${PDFJS_ICCS_PATH}CGATS001Compat-v2-micro.icc`,
        `${PDFJS_ICCS_PATH}LICENSE`,
      ]),
    );
    expect(names).toEqual(expect.arrayContaining(["pdfjs/cmaps/90ms-RKSJ-H.bcmap", "pdfjs/cmaps/UniGB-UCS2-H.bcmap"]));
  });

  it("are emitted into the build at the paths pdf.js is given", () => {
    const files = emitted();
    expect(files.map((file) => file.fileName)).toEqual([...pdfjsAssetFiles().keys()]);
    expect(files.every((file) => file.type === "asset")).toBe(true);
    const byName = new Map(files.map((file) => [file.fileName, Buffer.from(file.source)]));
    expect(byName.get(`${PDFJS_STANDARD_FONTS_PATH}FoxitSymbol.pfb`)).toEqual(
      distBytes("standard_fonts", "FoxitSymbol.pfb"),
    );
    expect(byName.get(`${PDFJS_WASM_PATH}openjpeg.wasm`)).toEqual(distBytes("wasm", "openjpeg.wasm"));
  });

  it.each(["/", "/web/"])("are served by the dev server under the %s base", (base) => {
    const request = devServer(base);
    const fonts = pdfjsStandardFontDataUrl(base);
    const wasm = pdfjsWasmUrl(base);
    const symbol = request(`${fonts}FoxitSymbol.pfb?import`);
    expect(symbol.next).not.toHaveBeenCalled();
    expect(Buffer.from(symbol.body ?? [])).toEqual(distBytes("standard_fonts", "FoxitSymbol.pfb"));
    expect(symbol.type).toBe("application/octet-stream");
    const openjpeg = request(`${wasm}openjpeg.wasm`);
    expect(Buffer.from(openjpeg.body ?? [])).toEqual(distBytes("wasm", "openjpeg.wasm"));
    expect(openjpeg.type).toBe("application/wasm");
    expect(request(`${wasm}openjpeg_nowasm_fallback.js`).type).toBe("text/javascript");
    expect(request(`${wasm}quickjs-eval.wasm`).next).toHaveBeenCalledOnce();
    expect(Buffer.from(request(`${pdfjsCMapUrl(base)}90ms-RKSJ-H.bcmap`).body ?? [])).toEqual(
      distBytes("cmaps", "90ms-RKSJ-H.bcmap"),
    );
    expect(request(`${fonts}../package.json`).next).toHaveBeenCalledOnce();
    expect(request(fonts).next).toHaveBeenCalledOnce();
    expect(request(`${base}index.html`).next).toHaveBeenCalledOnce();
  });

  it("are part of the desktop and the browser app builds", async () => {
    const desktop = await (desktopConfig as unknown as (env: unknown) => Promise<{ plugins?: unknown[] }>)({
      command: "build",
      mode: "production",
    });
    expect(pluginNames(desktop.plugins)).toContain("pdfjs-assets");
    expect(pluginNames(webConfig.plugins)).toContain("pdfjs-assets");
  });
});
