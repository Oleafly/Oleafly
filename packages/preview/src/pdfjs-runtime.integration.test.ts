// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type PdfJs = typeof import("pdfjs-dist");
type LoadedFont = { name?: string; missingFile?: boolean; data?: Uint8Array };

const ITERATOR = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;

const RECENT_FEATURES: readonly (readonly [object, string])[] = [
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
