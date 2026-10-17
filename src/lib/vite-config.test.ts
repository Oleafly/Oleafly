import { describe, expect, it } from "vitest";
import { LAZY_NAMESPACES, NAMESPACES } from "@/i18n/resources";
import {
  entriesLoadingBeforePolyfills,
  LEGAL_COMMENT_PATTERN,
  localeChunk,
  POLYFILLS_CHUNK,
  polyfillsChunk,
} from "../../vite.config";

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
