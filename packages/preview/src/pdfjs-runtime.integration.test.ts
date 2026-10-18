// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { brotliCompressSync, deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dropNativeDecompression } from "./worker-decompression";

type PdfJs = typeof import("pdfjs-dist");
type LoadedFont = { name?: string; missingFile?: boolean; data?: Uint8Array };
type DecompressionStreamCtor = new (format: string) => object;

const MAC_WKWEBVIEW =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

const ITERATOR = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;

const RECENT_FEATURES: readonly (readonly [object, string])[] = [
  // Only the constructor is new (Safari 18.4); older engines still have the
  // iterator prototype it exposes. pdf.js reads it as its modules load.
  [globalThis, "Iterator"],
  [Math, "sumPrecise"],
  [Promise, "try"],
  [Promise, "withResolvers"],
  [Uint8Array.prototype, "toBase64"],
  [Uint8Array.prototype, "toHex"],
  [Uint8Array, "fromBase64"],
  [Map.prototype, "getOrInsert"],
  [Map.prototype, "getOrInsertComputed"],
  [WeakMap.prototype, "getOrInsert"],
  [WeakMap.prototype, "getOrInsertComputed"],
  [RegExp, "escape"],
  [Set.prototype, "intersection"],
  [ArrayBuffer.prototype, "transferToFixedLength"],
  [Set.prototype, "union"],
  [Set.prototype, "difference"],
  [Set.prototype, "symmetricDifference"],
  [Set.prototype, "isSubsetOf"],
  [Set.prototype, "isSupersetOf"],
  [Set.prototype, "isDisjointFrom"],
  [ArrayBuffer.prototype, "transfer"],
  [ITERATOR, "map"],
  [ITERATOR, "filter"],
  [ITERATOR, "take"],
  [ITERATOR, "drop"],
  [ITERATOR, "flatMap"],
  [ITERATOR, "reduce"],
  [ITERATOR, "toArray"],
  [ITERATOR, "forEach"],
  [ITERATOR, "some"],
  [ITERATOR, "every"],
  [ITERATOR, "find"],
  [Array.prototype, "toReversed"],
  [Array.prototype, "toSorted"],
  [Array.prototype, "toSpliced"],
  [Array.prototype, "with"],
  [URL, "parse"],
];

const SHIPPED_BUILDS = ["build/pdf.mjs", "build/pdf.worker.min.mjs", "web/pdf_viewer.mjs"];

const RECENT_BUILT_INS: readonly (readonly [string, RegExp, "polyfilled" | "detected" | "missing"])[] = [
  ["Math.sumPrecise", /Math\.sumPrecise\(/u, "polyfilled"],
  ["Promise.try", /Promise\.try\(/u, "polyfilled"],
  ["Promise.withResolvers", /Promise\.withResolvers\(/u, "polyfilled"],
  ["Uint8Array toBase64 and toHex", /\.to(?:Base64|Hex)\(/u, "polyfilled"],
  ["Uint8Array.fromBase64", /\.fromBase64\(/u, "polyfilled"],
  ["Uint8Array.fromHex", /\.fromHex\(/u, "missing"],
  ["Uint8Array setFromBase64 and setFromHex", /\.setFrom(?:Base64|Hex)\(/u, "missing"],
  ["Map and WeakMap getOrInsert", /\.getOrInsert(?:Computed)?\(/u, "polyfilled"],
  ["RegExp.escape", /RegExp\.escape\(/u, "polyfilled"],
  ["Set methods", /\.(?:union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/u, "polyfilled"],
  ["ArrayBuffer transfer", /\.transfer(?:ToFixedLength)?\(/u, "polyfilled"],
  ["Iterator constructor", /\bIterator\.prototype\b/u, "polyfilled"],
  ["Iterator helpers", /\.(?:keys|values|entries)\(\)\.(?:map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\(|\.toArray\(\)/u, "polyfilled"],
  ["Iterator.from, concat and zip", /Iterator\.(?:from|concat|zip)\(/u, "missing"],
  ["URL.parse", /URL\.parse\(/u, "polyfilled"],
  ["URL.canParse", /URL\.canParse\(/u, "missing"],
  ["Array change by copy", /\.(?:toReversed|toSorted|toSpliced)\(/u, "polyfilled"],
  ["Object and Map groupBy", /(?:Object|Map)\.groupBy\(/u, "missing"],
  ["Array.fromAsync", /Array\.fromAsync\(/u, "missing"],
  ["String isWellFormed and toWellFormed", /\.(?:isWellFormed|toWellFormed)\(/u, "missing"],
  ["Error.isError", /Error\.isError\(/u, "missing"],
  ["Math.f16round", /Math\.f16round\(/u, "missing"],
  ["Atomics waitAsync and pause", /Atomics\.(?:waitAsync|pause)\(/u, "missing"],
  ["ReadableStream.from", /ReadableStream\.from\(/u, "missing"],
  ["Float16Array", /Float16Array/u, "detected"],
  ["Temporal", /Temporal\./u, "detected"],
];

const saved = RECENT_FEATURES.map(
  ([owner, key]) => [owner, key, Object.getOwnPropertyDescriptor(owner, key)] as const,
);
let pdfjs: PdfJs;

beforeAll(async () => {
  for (const [owner, key] of RECENT_FEATURES) Reflect.deleteProperty(owner, key);
  await import("./polyfills");
  pdfjs = await import("pdfjs-dist");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(
    "pdfjs-dist/build/pdf.worker.min.mjs"
  );
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "pdfjsWorker");
  for (const [owner, key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(owner, key, descriptor);
    else Reflect.deleteProperty(owner, key);
  }
});

async function loadedFonts(fixture: string) {
  const messages: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  });
  try {
    const data = new Uint8Array(readFileSync(new URL(`./__fixtures__/${fixture}`, import.meta.url)));
    const task = pdfjs.getDocument({ data, fontExtraProperties: true });
    const page = await (await task.promise).getPage(1);
    const operators = await page.getOperatorList();
    const fonts = new Map<string, LoadedFont>();
    operators.fnArray.forEach((operator, index) => {
      if (operator !== pdfjs.OPS.setFont) return;
      const id = String((operators.argsArray[index] as unknown[])[0]);
      fonts.set(id, page.commonObjs.get(id) as LoadedFont);
    });
    await task.destroy();
    return { fonts: [...fonts.values()], messages };
  } finally {
    log.mockRestore();
  }
}

function onePagePdf(filter: string, encoded: Uint8Array) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (body: string) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.7\n");
  object("<< /Type /Catalog /Pages 2 0 R >>");
  object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  offsets.push(length);
  push(`5 0 obj\n<< /Length ${encoded.length} /Filter /${filter} >>\nstream\n`);
  push(encoded);
  push("\nendstream\nendobj\n");
  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const pdf = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    pdf.set(part, at);
    at += part.length;
  }
  return pdf;
}

async function readFirstPage(data: Uint8Array) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const task = pdfjs.getDocument({ data, fontExtraProperties: true });
    const page = await (await task.promise).getPage(1);
    const operators = await page.getOperatorList();
    const fonts: { name?: string; data?: Uint8Array }[] = [];
    operators.fnArray.forEach((operator, index) => {
      if (operator !== pdfjs.OPS.setFont) return;
      const font = page.commonObjs.get(String((operators.argsArray[index] as unknown[])[0])) as LoadedFont;
      fonts.push({ name: font.name, data: font.data });
    });
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join("");
    await task.destroy();
    return { fonts, text };
  } finally {
    log.mockRestore();
  }
}

async function withDecompression<T>(mode: "native" | "dropped", run: () => Promise<T>) {
  const scope = globalThis as { DecompressionStream?: DecompressionStreamCtor };
  const native = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
  const Native = scope.DecompressionStream;
  if (!native || !Native) throw new Error("this Node has no DecompressionStream to compare against");
  const formats: string[] = [];
  try {
    if (mode === "native") {
      scope.DecompressionStream = class extends Native {
        constructor(format: string) {
          formats.push(format);
          super(format);
        }
      };
    } else {
      expect(dropNativeDecompression(globalThis, MAC_WKWEBVIEW)).toBe(true);
    }
    return { result: await run(), formats };
  } finally {
    Object.defineProperty(globalThis, "DecompressionStream", native);
  }
}

describe("pdf.js without the native DecompressionStream", () => {
  it("inflates a LaTeX PDF in JavaScript to the same fonts and text as the native stream", async () => {
    const data = readFileSync(new URL("./__fixtures__/embedded-fonts.pdf", import.meta.url));
    const native = await withDecompression("native", () => readFirstPage(new Uint8Array(data)));
    const javascript = await withDecompression("dropped", () => readFirstPage(new Uint8Array(data)));
    expect(native.formats).toContain("deflate");
    expect(javascript.formats).toEqual([]);
    expect(javascript.result.text).toContain("Playfair heading");
    expect(javascript.result.fonts.length).toBeGreaterThan(0);
    for (const font of javascript.result.fonts) expect(font.data?.length, font.name).toBeGreaterThan(0);
    expect(javascript.result).toEqual(native.result);
  });

  it.each([
    ["FlateDecode", deflateSync],
    ["BrotliDecode", brotliCompressSync],
  ] as const)("reads a %s content stream with its JavaScript decoder", async (filter, compress) => {
    const content = new TextEncoder().encode("BT /F1 12 Tf 20 40 Td (Decoded in JavaScript) Tj ET");
    const pdf = onePagePdf(filter, new Uint8Array(compress(content)));
    const { result } = await withDecompression("dropped", () => readFirstPage(pdf));
    expect(result.text).toBe("Decoded in JavaScript");
  });
});

describe("pdf.js on a WebView without the newest JavaScript built-ins", () => {
  it.each([
    ["embedded-fonts.pdf", 5],
    ["type1-fonts.pdf", 2],
  ])("draws every font embedded in %s from its own glyphs", async (fixture, count) => {
    const { fonts, messages } = await loadedFonts(fixture);
    expect(fonts).toHaveLength(count);
    for (const font of fonts) {
      expect(font.missingFile, font.name).toBe(false);
      expect(font.data?.length, font.name).toBeGreaterThan(0);
    }
    expect(messages.filter((message) => /is not a function|substitute the font/u.test(message))).toEqual([]);
  });
});

describe("recent built-ins the shipped pdf.js relies on", () => {
  it("has a polyfill or a pdf.js feature check for every one it calls", () => {
    const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    const source = SHIPPED_BUILDS.map((file) => readFileSync(join(root, file), "utf8")).join("\n");
    const unhandled = RECENT_BUILT_INS.filter(
      ([, pattern, status]) => status === "missing" && pattern.test(source),
    ).map(([name]) => name);
    expect(unhandled, "pdf.js now calls these; add a polyfill in polyfills.ts and list it here").toEqual([]);
    for (const [owner, key] of RECENT_FEATURES) {
      expect(typeof (owner as Record<string, unknown>)[key], key).toBe("function");
    }
  });
});
