import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import researchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import { downscaleImage } from "./image-downscale";
import { IMAGE_BUDGETS } from "./image-input";
import { ToolsModelError } from "./tools-model";
import {
  encodeAttempts,
  fitWithin,
  MAX_SHRINKS,
  pngMayHaveAlpha,
  runDownscale,
  SHRINK_FACTOR,
  type DownscaleCanvas,
  type DownscaleContext,
  type DownscaleEnv,
  type DownscaleRequest,
} from "./image-downscale-core";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

function encoded(mime: string, size: number): Blob {
  const bytes = new Uint8Array(Math.max(size, 8));
  bytes.set(mime === "image/png" ? PNG_MAGIC : JPEG_MAGIC);
  return new Blob([bytes], { type: mime });
}

interface FakeCanvas extends DownscaleCanvas {
  width: number;
  height: number;
  calls: string[];
}

function fakeEnv(
  bitmap: { width: number; height: number },
  sizeFor: (mime: string, quality: number | undefined, width: number) => number,
): DownscaleEnv & { canvases: FakeCanvas[] } {
  const canvases: FakeCanvas[] = [];
  return {
    canvases,
    decode: async () => ({ ...bitmap, close: vi.fn() }) as unknown as ImageBitmap,
    canvas: (width, height) => {
      const calls: string[] = [];
      const context: DownscaleContext = {
        set fillStyle(value: string | CanvasGradient | CanvasPattern) {
          calls.push(`fillStyle ${String(value)}`);
        },
        get fillStyle() {
          return "";
        },
        fillRect: () => calls.push("fillRect"),
        drawImage: () => calls.push("drawImage"),
      };
      const canvas: FakeCanvas = {
        width,
        height,
        calls,
        getContext: () => context,
        encode: async (mime, quality) => encoded(mime, sizeFor(mime, quality, width)),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
}

function chunk(type: string, data: number[] = []): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...Array.from(type, (character) => character.codePointAt(0) ?? 0),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

function pngBytes(colorType: number, before: number[][] = []): Uint8Array {
  return new Uint8Array([
    ...PNG_MAGIC,
    ...chunk("IHDR", [0, 0, 2, 0x53, 0, 0, 3, 0x4a, 8, colorType, 0, 0, 0]),
    ...before.flat(),
    ...chunk("IDAT", [0x78, 0x9c]),
    ...chunk("tRNS", [0]),
    ...chunk("IEND"),
  ]);
}

function request(overrides: Partial<DownscaleRequest> = {}): DownscaleRequest {
  return {
    bytes: new Uint8Array(PNG_MAGIC).buffer,
    mime: "image/png",
    maxEdge: 2_000,
    maxBytes: 1_000,
    accept: ["image/png", "image/jpeg", "image/webp"],
    ...overrides,
  };
}

describe("downscale rules", () => {
  it.each([
    [4000, 3000, 2000, 2000, 1500],
    [1000, 800, 2000, 1000, 800],
    [3000, 10, 2000, 2000, 7],
    [5000, 5000, null, 5000, 5000],
    [0, 0, 2000, 1, 1],
  ] as const)("fitWithin(%i, %i, %s) is %i×%i", (width, height, maxEdge, fitWidth, fitHeight) => {
    expect(fitWithin(width, height, maxEdge)).toMatchObject({ width: fitWidth, height: fitHeight });
  });

  it("tries lossless PNG first for a PNG source, then JPEG at 0.92, 0.85 and 0.75", () =>
    expect(encodeAttempts("image/png", ["image/png", "image/jpeg"])).toEqual([
      { mime: "image/png" },
      { mime: "image/jpeg", quality: 0.92 },
      { mime: "image/jpeg", quality: 0.85 },
      { mime: "image/jpeg", quality: 0.75 },
    ]));

  it("re-encodes photos as JPEG only", () => {
    expect(encodeAttempts("image/jpeg", ["image/png", "image/jpeg"])[0]).toEqual({ mime: "image/jpeg", quality: 0.92 });
    expect(encodeAttempts("image/webp", ["image/png", "image/jpeg"]).every((attempt) => attempt.mime === "image/jpeg")).toBe(true);
    expect(encodeAttempts("image/webp", ["image/png"])).toEqual([{ mime: "image/png" }]);
    expect(encodeAttempts("image/png", ["image/webp"])).toEqual([]);
  });

  it("leaves a PNG that already fits unchanged and re-encodes a JPEG that fits", async () => {
    const env = fakeEnv({ width: 800, height: 600 }, () => 500);
    await expect(runDownscale(request(), env)).resolves.toEqual({ unchanged: true });
    expect(env.canvases).toHaveLength(0);

    const reply = await runDownscale(
      request({ bytes: new Uint8Array(JPEG_MAGIC).buffer, mime: "image/jpeg" }),
      env,
    );
    expect(reply).toMatchObject({ unchanged: false, mime: "image/jpeg" });
    expect(env.canvases[0]).toMatchObject({ width: 800, height: 600 });
  });

  it("knows which PNGs can hold transparent pixels", () => {
    expect(pngMayHaveAlpha(pngBytes(6))).toBe(true);
    expect(pngMayHaveAlpha(pngBytes(4))).toBe(true);
    expect(pngMayHaveAlpha(pngBytes(3, [chunk("PLTE", [0, 0, 0]), chunk("tRNS", [0])]))).toBe(true);
    expect(pngMayHaveAlpha(pngBytes(2))).toBe(false);
    expect(pngMayHaveAlpha(pngBytes(3, [chunk("PLTE", [0, 0, 0])]))).toBe(false);
    expect(pngMayHaveAlpha(new Uint8Array(PNG_MAGIC))).toBe(false);
    expect(pngMayHaveAlpha(new Uint8Array([...JPEG_MAGIC, ...new Array(40).fill(0)]))).toBe(false);
  });

  it("draws a PNG that fits but can be transparent onto white instead of sending it as it is", async () => {
    const env = fakeEnv({ width: 595, height: 842 }, () => 500);
    const reply = await runDownscale(request({ bytes: pngBytes(6).buffer as ArrayBuffer }), env);
    expect(reply).toMatchObject({ unchanged: false, mime: "image/png" });
    expect(env.canvases[0]).toMatchObject({ width: 595, height: 842 });
    expect(env.canvases[0].calls).toEqual(["fillStyle #ffffff", "fillRect", "drawImage"]);

    await expect(runDownscale(request({ bytes: pngBytes(2).buffer as ArrayBuffer }), env)).resolves.toEqual({
      unchanged: true,
    });
  });

  it("re-encodes a PNG that is too large in bytes or pixels", async () => {
    const env = fakeEnv({ width: 4000, height: 3000 }, () => 500);
    const reply = await runDownscale(request(), env);
    expect(reply).toMatchObject({ unchanged: false, mime: "image/png" });
    expect(env.canvases[0]).toMatchObject({ width: 2000, height: 1500 });
  });

  it("paints a white background before drawing so transparent PNGs never turn black", async () => {
    const env = fakeEnv({ width: 4000, height: 3000 }, () => 500);
    await runDownscale(request(), env);
    expect(env.canvases[0].calls).toEqual(["fillStyle #ffffff", "fillRect", "drawImage"]);
  });

  it("falls back to smaller JPEG quality before shrinking", async () => {
    const env = fakeEnv({ width: 1500, height: 1000 }, (mime, quality) =>
      mime === "image/png" ? 5_000 : (quality ?? 1) > 0.8 ? 2_000 : 900,
    );
    const reply = await runDownscale(request({ maxEdge: 2_000, maxBytes: 1_000, bytes: new Uint8Array(5_000).buffer }), env);
    expect(reply).toMatchObject({ unchanged: false, mime: "image/jpeg" });
    expect(env.canvases).toHaveLength(1);
  });

  it("shrinks by 0.8 up to three times, then reports too-large", async () => {
    const env = fakeEnv({ width: 2000, height: 1000 }, () => 10_000);
    await expect(runDownscale(request({ bytes: new Uint8Array(20_000).buffer }), env)).resolves.toEqual({
      error: "too-large",
    });
    expect(env.canvases.map((canvas) => canvas.width)).toEqual([2000, 1600, 1280, 1024]);
    expect(env.canvases).toHaveLength(MAX_SHRINKS + 1);
    expect(SHRINK_FACTOR).toBe(0.8);
  });

  it("succeeds after a shrink when the smaller size fits", async () => {
    const env = fakeEnv({ width: 2000, height: 1000 }, (_mime, _quality, width) => (width > 1600 ? 10_000 : 900));
    const reply = await runDownscale(request({ bytes: new Uint8Array(20_000).buffer }), env);
    expect(reply).toMatchObject({ unchanged: false });
    expect(env.canvases.map((canvas) => canvas.width)).toEqual([2000, 1600]);
  });

  it("reports images it cannot decode, and engines without a 2D canvas", async () => {
    const broken: DownscaleEnv = {
      decode: async () => {
        throw new Error("bad image");
      },
      canvas: () => {
        throw new Error("never drawn");
      },
    };
    await expect(runDownscale(request(), broken)).resolves.toEqual({ error: "decode" });
    const noContext: DownscaleEnv = {
      decode: async () => ({ width: 4000, height: 10, close: () => {} }) as unknown as ImageBitmap,
      canvas: () => ({ getContext: () => null, encode: async () => null }),
    };
    await expect(runDownscale(request(), noContext)).resolves.toEqual({ error: "unsupported" });
  });

  it("ignores an encoder that answers with another format", async () => {
    const env = fakeEnv({ width: 4000, height: 3000 }, () => 500);
    const original = env.canvas;
    env.canvas = (width, height) => {
      const canvas = original(width, height);
      return { ...canvas, encode: async () => encoded("image/png", 500) };
    };
    const reply = await runDownscale(
      request({ mime: "image/jpeg", bytes: new Uint8Array(JPEG_MAGIC).buffer, accept: ["image/jpeg"] }),
      env,
    );
    expect(reply).toEqual({ error: "too-large" });
  });
});

describe("downscale client", () => {
  type Reply = { error: string } | { unchanged: true } | { unchanged: false; bytes: ArrayBuffer; mime: string };
  let workerReply: Reply;
  let posted: unknown[];

  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: { id: number }) {
      posted.push(message);
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, reply: workerReply } }));
    }
    terminate() {}
  }

  function stubCanvasDocument() {
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: (callback: (blob: Blob | null) => void, mime: string) => callback(encoded(mime, 64)),
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3000, height: 2000, close: () => {} })),
    );
    return canvas;
  }

  beforeEach(() => {
    posted = [];
    workerReply = { error: "unsupported" };
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the main thread when the worker has no OffscreenCanvas", async () => {
    const canvas = stubCanvasDocument();
    const input = { bytes: new Uint8Array(JPEG_MAGIC), mime: "image/jpeg" as const };
    const result = await downscaleImage(input, IMAGE_BUDGETS.hosted);
    expect(posted).toHaveLength(1);
    expect(canvas.getContext).toHaveBeenCalledWith("2d");
    expect(result.mime).toBe("image/jpeg");
    expect(Array.from(result.bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(input.bytes.byteLength).toBe(4);
  });

  it("uses the worker's answer when it has one", async () => {
    workerReply = { unchanged: false, bytes: new Uint8Array(JPEG_MAGIC).buffer, mime: "image/jpeg" };
    const result = await downscaleImage({ bytes: new Uint8Array(PNG_MAGIC), mime: "image/png" }, IMAGE_BUDGETS.mathpix);
    expect(result).toEqual({ bytes: new Uint8Array(JPEG_MAGIC), mime: "image/jpeg" });
    expect(posted[0]).toMatchObject({
      request: { maxEdge: 2_000, maxBytes: 1_450_000, accept: ["image/png", "image/jpeg"], mime: "image/png" },
    });

    workerReply = { unchanged: true };
    const input = { bytes: new Uint8Array(PNG_MAGIC), mime: "image/png" as const };
    await expect(downscaleImage(input, IMAGE_BUDGETS.hosted)).resolves.toBe(input);
  });

  it("turns too-large into a Tools error the converter can show", async () => {
    workerReply = { error: "too-large" };
    const failure = downscaleImage({ bytes: new Uint8Array(PNG_MAGIC), mime: "image/png" }, IMAGE_BUDGETS.hosted);
    await expect(failure).rejects.toBeInstanceOf(ToolsModelError);
    await expect(failure).rejects.toThrow(researchTools.converterModel.errors.imageTooLarge);
  });

  it("reports an undecodable image in the converter's words", async () => {
    workerReply = { error: "decode" };
    await expect(
      downscaleImage({ bytes: new Uint8Array(PNG_MAGIC), mime: "image/png" }, IMAGE_BUDGETS.hosted),
    ).rejects.toThrow(researchTools.converterErrors.imageFormat);
  });
});
