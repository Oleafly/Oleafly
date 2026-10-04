// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bitmapToPngDataUrl, rawToRgba, rgbaToPngDataUrl } from "./figure-decode";

describe("rawToRgba", () => {
  it("expands RGB24 to RGBA", () => {
    const rgba = rawToRgba(new Uint8Array([10, 20, 30, 40, 50, 60]), 2, 1, 2);
    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("passes RGBA32 through", () => {
    const rgba = rawToRgba(new Uint8Array([1, 2, 3, 4]), 1, 1, 3);
    expect([...rgba]).toEqual([1, 2, 3, 4]);
  });

  it("expands 1bpp grayscale bits to opaque pixels", () => {
    const rgba = rawToRgba(new Uint8Array([0b10000000]), 2, 1, 1);
    expect([...rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 0, 255]);
  });

  it("respects row byte padding for 1bpp", () => {
    const rgba = rawToRgba(new Uint8Array([0b10000000, 0b01000000]), 2, 2, 1);
    expect([...rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...rgba.slice(12, 16)]).toEqual([255, 255, 255, 255]);
  });
});

describe("canvas encoding", () => {
  class FakeImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubCanvas(context: Partial<CanvasRenderingContext2D> | null) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
    );
    return vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockImplementation(function (this: HTMLCanvasElement, type?: string) {
        return `data:${type};${this.width}x${this.height}`;
      });
  }

  it("draws a decoded bitmap at its own size and encodes it as PNG", () => {
    const drawImage = vi.fn();
    const toDataURL = stubCanvas({ drawImage });
    const bitmap = { width: 80, height: 60 } as ImageBitmap;

    expect(bitmapToPngDataUrl(bitmap, 40, 30)).toBe("data:image/png;40x30");
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 40, 30);
    expect(toDataURL).toHaveBeenCalledOnce();
  });

  it("puts raw RGBA pixels on a canvas and encodes it as PNG", () => {
    vi.stubGlobal("ImageData", FakeImageData);
    const putImageData = vi.fn();
    stubCanvas({ putImageData });
    const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);

    expect(rgbaToPngDataUrl(rgba, 2, 1)).toBe("data:image/png;2x1");
    const [image, x, y] = putImageData.mock.calls[0] as [FakeImageData, number, number];
    expect([x, y]).toEqual([0, 0]);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.data]).toEqual([...rgba]);
    expect(image.data).not.toBe(rgba);
  });

  it("fails clearly when the canvas has no 2D context", () => {
    stubCanvas(null);
    expect(() => bitmapToPngDataUrl({} as ImageBitmap, 1, 1)).toThrow("canvas 2d context unavailable");
    expect(() => rgbaToPngDataUrl(new Uint8ClampedArray(4), 1, 1)).toThrow("canvas 2d context unavailable");
  });
});
