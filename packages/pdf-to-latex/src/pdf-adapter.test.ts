import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(async () => {}),
  workerOptions: {} as { workerSrc?: string },
  bitmapToPngDataUrl: vi.fn((_bitmap: unknown, width: number, height: number) => `data:bitmap:${width}x${height}`),
  rgbaToPngDataUrl: vi.fn((_rgba: Uint8ClampedArray, width: number, height: number) => `data:rgba:${width}x${height}`),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: mocks.workerOptions,
  getDocument: mocks.getDocument,
  OPS: { paintImageXObject: 85, paintInlineImageXObject: 86, setFont: 37 },
}));

vi.mock("./figure-decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./figure-decode")>()),
  bitmapToPngDataUrl: mocks.bitmapToPngDataUrl,
  rgbaToPngDataUrl: mocks.rgbaToPngDataUrl,
}));

import { rawToRgba } from "./figure-decode";
import { extractPagesForConvert } from "./pdf-adapter";

type Store = Map<string, unknown>;

interface FakePageSpec {
  items?: unknown[];
  ops?: { fnArray: number[]; argsArray: unknown[][] } | Error;
  common?: Store;
  local?: Store;
  view?: number[];
  commonGet?: (id: string, callback?: (value: unknown) => void) => unknown;
}

function fakePage(spec: FakePageSpec) {
  const common = spec.common ?? new Map();
  const local = spec.local ?? new Map();
  return {
    view: spec.view ?? [0, 0, 612, 792],
    getTextContent: vi.fn(async () => ({ items: spec.items ?? [] })),
    getOperatorList: vi.fn(async () => {
      if (spec.ops instanceof Error) throw spec.ops;
      return spec.ops ?? { fnArray: [], argsArray: [] };
    }),
    commonObjs: {
      has: vi.fn((id: string) => common.has(id)),
      get: vi.fn(
        spec.commonGet ??
          ((id: string, callback?: (value: unknown) => void) => {
            const value = common.get(id);
            if (callback) {
              callback(value);
              return undefined;
            }
            return value;
          }),
      ),
    },
    objs: {
      get: vi.fn((id: string, callback: (value: unknown) => void) => {
        if (!local.has(id)) throw new Error(`object ${id} not resolved`);
        callback(local.get(id));
      }),
    },
  };
}

function openDocument(pages: ReturnType<typeof fakePage>[]) {
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: vi.fn(async (number: number) => pages[number - 1]),
    }),
    destroy: mocks.destroy,
  });
}

function textItem(str: string, transform: number[], extra: Record<string, unknown> = {}) {
  return { str, transform, width: str.length * 5, height: 10, fontName: "g_d0_f1", ...extra };
}

function rgbImage(width: number, height: number, extra: Record<string, unknown> = {}) {
  return { width, height, data: new Uint8Array(width * height * 3).fill(7), kind: 2, ...extra };
}

describe("extractPagesForConvert", () => {
  beforeEach(() => {
    mocks.getDocument.mockReset();
    mocks.destroy.mockClear();
    mocks.bitmapToPngDataUrl.mockClear();
    mocks.rgbaToPngDataUrl.mockClear();
  });

  it("points pdf.js at the bundled worker", () => {
    expect(typeof mocks.workerOptions.workerSrc).toBe("string");
    expect(mocks.workerOptions.workerSrc).not.toBe("");
  });

  it("hands pdf.js a copy of the bytes and always tears the document down", async () => {
    openDocument([]);
    const bytes = new Uint8Array([37, 80, 68, 70]);

    expect(await extractPagesForConvert(bytes)).toEqual({ pages: [], figures: [] });

    const { data } = mocks.getDocument.mock.calls[0][0] as { data: Uint8Array };
    expect(data).toEqual(bytes);
    expect(data).not.toBe(bytes);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("reads positioned text with real face names and page size", async () => {
    const page = fakePage({
      view: [10, 20, 622, 812],
      common: new Map([["g_d0_f1", { name: "ABCDEF+Times-Bold" }]]),
      items: [
        textItem("Title", [18, 0, 0, 18, 72, 700]),
        { type: "beginMarkedContent" },
        textItem("", [10, 0, 0, 10, 72, 690]),
        textItem("body", [10, 0, 0, 10, 72, 680]),
        textItem("flat", [10, 0, 0, 0, 72, 670], { height: 9 }),
        textItem("raw", [10, 0, 0, 10, 72, 660], { fontName: "g_d0_f9" }),
      ],
    });
    openDocument([page]);

    const { pages } = await extractPagesForConvert(new Uint8Array([1]));

    expect(pages).toEqual([
      {
        width: 612,
        height: 792,
        figureNames: [],
        items: [
          { str: "Title", x: 72, y: 700, width: 25, height: 10, fontName: "ABCDEF+Times-Bold", fontSize: 18 },
          { str: "body", x: 72, y: 680, width: 20, height: 10, fontName: "ABCDEF+Times-Bold", fontSize: 10 },
          { str: "flat", x: 72, y: 670, width: 20, height: 9, fontName: "ABCDEF+Times-Bold", fontSize: 9 },
          { str: "raw", x: 72, y: 660, width: 15, height: 10, fontName: "g_d0_f9", fontSize: 10 },
        ],
      },
    ]);
    expect(page.commonObjs.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the internal font id when the font object cannot be read", async () => {
    const page = fakePage({
      common: new Map([["g_d0_f1", {}]]),
      commonGet: () => {
        throw new Error("font not loaded");
      },
      items: [textItem("x", [10, 0, 0, 10, 0, 0])],
    });
    openDocument([page]);

    const { pages } = await extractPagesForConvert(new Uint8Array([1]));

    expect(pages[0].items[0].fontName).toBe("g_d0_f1");
  });

  it("extracts page-local, shared and inline images as numbered PNG figures", async () => {
    const local = rgbImage(40, 32);
    const shared = { width: 64, height: 48, bitmap: { close() {} } };
    const inline = rgbImage(33, 33, { kind: undefined, data: new Uint8Array(33 * 33 * 4) });
    const page1 = fakePage({
      local: new Map([["img_p0_1", local]]),
      common: new Map([["g_img_1", shared]]),
      ops: {
        fnArray: [37, 85, 85, 86],
        argsArray: [["g_d0_f1", 10], ["img_p0_1"], ["g_img_1"], [inline]],
      },
    });
    const page2 = fakePage({
      local: new Map([["img_p1_1", rgbImage(50, 50)]]),
      ops: { fnArray: [85], argsArray: [["img_p1_1"]] },
    });
    openDocument([page1, page2]);

    const { pages, figures } = await extractPagesForConvert(new Uint8Array([1]));

    expect(figures).toEqual([
      { name: "figure_p1_1.png", page: 1, pngDataUrl: "data:rgba:40x32" },
      { name: "figure_p1_2.png", page: 1, pngDataUrl: "data:bitmap:64x48" },
      { name: "figure_p1_3.png", page: 1, pngDataUrl: "data:rgba:33x33" },
      { name: "figure_p2_1.png", page: 2, pngDataUrl: "data:rgba:50x50" },
    ]);
    expect(pages.map((page) => page.figureNames)).toEqual([
      ["figure_p1_1.png", "figure_p1_2.png", "figure_p1_3.png"],
      ["figure_p2_1.png"],
    ]);
    expect(mocks.rgbaToPngDataUrl.mock.calls[0][0]).toEqual(rawToRgba(local.data, 40, 32, 2));
    expect(mocks.bitmapToPngDataUrl).toHaveBeenCalledWith(shared.bitmap, 64, 48);
    expect(mocks.rgbaToPngDataUrl.mock.calls[1][0]).toEqual(rawToRgba(inline.data, 33, 33, 3));
  });

  it("infers RGB and 1-bit layouts when pdf.js leaves the image kind out", async () => {
    const rgb = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 3).fill(200) };
    const mono = { width: 32, height: 32, data: new Uint8Array(32 * 4).fill(0xff) };
    openDocument([
      fakePage({
        local: new Map<string, unknown>([
          ["rgb", rgb],
          ["mono", mono],
        ]),
        ops: { fnArray: [85, 85], argsArray: [["rgb"], ["mono"]] },
      }),
    ]);

    const { figures } = await extractPagesForConvert(new Uint8Array([1]));

    expect(figures).toHaveLength(2);
    expect(mocks.rgbaToPngDataUrl.mock.calls[0][0]).toEqual(rawToRgba(rgb.data, 32, 32, 2));
    expect(mocks.rgbaToPngDataUrl.mock.calls[1][0]).toEqual(rawToRgba(mono.data, 32, 32, 1));
  });

  it("skips icons, empty images and objects that never resolve", async () => {
    openDocument([
      fakePage({
        local: new Map<string, unknown>([
          ["icon", rgbImage(16, 64)],
          ["empty", { width: 100, height: 100 }],
          ["null", null],
        ]),
        ops: {
          fnArray: [85, 85, 85, 85],
          argsArray: [["icon"], ["empty"], ["null"], ["missing"]],
        },
      }),
    ]);

    const { pages, figures } = await extractPagesForConvert(new Uint8Array([1]));

    expect(figures).toEqual([]);
    expect(pages[0].figureNames).toEqual([]);
  });

  it("drops one image that fails to encode and keeps the rest", async () => {
    mocks.rgbaToPngDataUrl.mockImplementationOnce(() => {
      throw new Error("canvas 2d context unavailable");
    });
    openDocument([
      fakePage({
        local: new Map([
          ["bad", rgbImage(40, 40)],
          ["good", rgbImage(40, 40)],
        ]),
        ops: { fnArray: [85, 85], argsArray: [["bad"], ["good"]] },
      }),
    ]);

    const { figures } = await extractPagesForConvert(new Uint8Array([1]));

    expect(figures).toEqual([{ name: "figure_p1_1.png", page: 1, pngDataUrl: "data:rgba:40x40" }]);
  });

  it("still returns the text when the operator list cannot be built", async () => {
    openDocument([
      fakePage({
        ops: new Error("bad content stream"),
        items: [textItem("survives", [10, 0, 0, 10, 72, 700])],
      }),
    ]);

    const { pages, figures } = await extractPagesForConvert(new Uint8Array([1]));

    expect(figures).toEqual([]);
    expect(pages[0].items.map((item) => item.str)).toEqual(["survives"]);
    expect(pages[0].figureNames).toEqual([]);
  });

  it("tears the document down when a page fails to load", async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn(async () => {
          throw new Error("page tree broken");
        }),
      }),
      destroy: mocks.destroy,
    });

    await expect(extractPagesForConvert(new Uint8Array([1]))).rejects.toThrow("page tree broken");
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
